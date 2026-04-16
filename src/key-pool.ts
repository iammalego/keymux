import OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { KeyPoolExhaustedError, maskKey } from './errors'
import { KeyScheduler } from './scheduler'
import type { Strategy } from './scheduler'

/**
 * Configuration for {@link KeyPool}.
 */
export interface KeyPoolConfig {
  /**
   * API keys to rotate across. Minimum 1; rotation is effective with 2+.
   * Each key should come from a **different Google account** when using Gemini free tier —
   * multiple keys from the same account share the same quota.
   */
  keys: string[]

  /**
   * Base URL of the API provider.
   *
   * Defaults to the OpenAI API URL.
   * For Gemini: `'https://generativelanguage.googleapis.com/v1beta/openai'`
   */
  baseURL?: string

  /**
   * Key rotation strategy.
   *
   * - `'round-robin'` (default): Cycles through keys in order. O(1). Deterministic.
   * - `'least-recently-used'`: Always picks the least-recently-used key. O(N).
   *   Recommended for Gemini free tier.
   */
  strategy?: Strategy

  /**
   * Maximum number of retry attempts before throwing {@link KeyPoolExhaustedError}.
   *
   * Defaults to `keys.length` — one attempt per key.
   * Increase to allow multiple attempts per key.
   */
  maxRetries?: number

  /**
   * Called when all keys are exhausted (all retries failed with 429).
   * Receives masked keys — safe to use in alerts or logs.
   *
   * @param maskedKeys - Array of masked key strings (e.g. `['AIza...cdef', 'AIza...wxyz']`).
   */
  onExhausted?: (maskedKeys: string[]) => void

  /**
   * Pass-through options forwarded to the underlying `OpenAI` client constructor.
   * Cannot override `apiKey`, `baseURL`, or `maxRetries` — those are managed by `KeyPool`.
   *
   * @example
   * new KeyPool({
   *   keys: [...],
   *   openaiOptions: { timeout: 30_000, defaultHeaders: { 'X-Custom': 'value' } }
   * })
   */
  openaiOptions?: Omit<ClientOptions, 'apiKey' | 'baseURL' | 'maxRetries'>
}

/**
 * A drop-in replacement for the `OpenAI` client that transparently rotates
 * across multiple API keys on every request and retry.
 *
 * `KeyPool` extends `OpenAI` — all SDK methods, namespaces, and types work identically.
 *
 * @example
 * ```typescript
 * import { KeyPool } from 'keymux'
 *
 * const client = new KeyPool({
 *   keys: [process.env.GEMINI_KEY_1!, process.env.GEMINI_KEY_2!],
 *   baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
 *   strategy: 'least-recently-used',
 * })
 *
 * // Use exactly like the OpenAI SDK:
 * const response = await client.chat.completions.create({
 *   model: 'gemini-2.0-flash',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * })
 * ```
 *
 * @throws {Error} If `keys` is empty or all keys are blank strings.
 * @throws {KeyPoolExhaustedError} When all keys have been rate-limited after exhausting retries.
 */
export class KeyPool extends OpenAI {
  readonly #keys: string[]
  readonly #config: KeyPoolConfig

  constructor(config: KeyPoolConfig) {
    const { keys, baseURL, strategy, maxRetries, openaiOptions } = config

    if (!keys || keys.length === 0) {
      throw new Error('KeyPool requires at least one API key in `keys`')
    }
    const validKeys = keys.filter((k) => typeof k === 'string' && k.trim() !== '')
    if (validKeys.length === 0) {
      throw new Error('KeyPool: all keys are empty strings — provide at least one non-empty key')
    }

    const scheduler = new KeyScheduler(validKeys, strategy)

    super({
      // The OpenAI SDK v6 calls this function before every request, including retries.
      // Combined with maxRetries = keys.length, each retry automatically uses the next key.
      apiKey: () => Promise.resolve(scheduler.nextKey()),
      baseURL,
      maxRetries: maxRetries ?? validKeys.length,
      ...(openaiOptions as object),
    } as ClientOptions)

    this.#keys = [...validKeys]
    this.#config = config

    // Override makeRequest (declared private in TS but accessible in JS at runtime).
    // This is the single interception point for all SDK methods (.chat, .embeddings, etc.).
    // We catch the final RateLimitError after all retries and wrap it as KeyPoolExhaustedError.
    // biome-ignore lint/suspicious/noExplicitAny: runtime access to private method unavailable in TS type system
    const proto = this as unknown as any
    const originalMakeRequest: (...args: unknown[]) => Promise<unknown> =
      // biome-ignore lint/complexity/useLiteralKeys: makeRequest is private in TS — bracket notation required
      proto['makeRequest'].bind(this)
    const self = this
    // biome-ignore lint/complexity/useLiteralKeys: makeRequest is private in TS — bracket notation required
    // biome-ignore lint/complexity/useArrowFunction: regular function preserves runtime prototype assignment semantics
    proto['makeRequest'] = async function (...args: unknown[]) {
      try {
        return await originalMakeRequest(...args)
      } catch (error) {
        if (error instanceof OpenAI.RateLimitError) {
          const maskedKeys = self.#keys.map(maskKey)
          try {
            self.#config.onExhausted?.(maskedKeys)
          } catch {
            // swallow errors thrown inside the user's callback
          }
          throw new KeyPoolExhaustedError(self.#keys, error)
        }
        throw error
      }
    }
  }

  /**
   * Returns a new `KeyPool` instance with the given options merged in.
   *
   * Note: the new instance starts with a fresh rotation state (scheduler is not shared).
   *
   * @param options - Options to merge into the current configuration.
   * @returns A new `KeyPool` instance.
   */
  override withOptions(options: Partial<ClientOptions>): this {
    const merged = new KeyPool({
      ...this.#config,
      openaiOptions: {
        ...this.#config.openaiOptions,
        ...(options as Omit<ClientOptions, 'apiKey' | 'baseURL' | 'maxRetries'>),
      },
    })
    return merged as this
  }
}
