import OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { BudgetTracker } from './budget-tracker'
import { KeyCooldownError, KeyPoolExhaustedError, maskKey } from './errors'
import { HealthMonitor, NULL_HEALTH_MONITOR } from './health-monitor'
import { resolveQuotas } from './presets'
import { RequestContext } from './request-context'
import { KeyScheduler } from './scheduler'
import type { Strategy } from './scheduler'
import { SmartScheduler } from './smart-scheduler'
import { createTokenEstimator } from './token-estimator'
import type { TokenCounter } from './token-estimator'
import type { HealthConfig, ProviderPreset, QuotaConfig, QuotaDimension } from './types'

/**
 * Configuration for {@link KeyPool}.
 */
export interface KeyPoolConfig {
  /**
   * API keys to rotate across. Minimum 1; rotation is effective with 2+.
   * Each key should come from a **different account** when using free tiers —
   * multiple keys from the same account share the same quota.
   *
   * Accepts an array of strings or a single comma-separated string:
   * ```typescript
   * keys: ['key1', 'key2', 'key3']
   * keys: 'key1,key2,key3'
   * keys: process.env.GEMINI_KEYS! // "key1,key2,key3"
   * ```
   */
  keys: string[] | string

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

  /**
   * Quota configuration for smart scheduling. Can be a named provider preset
   * (e.g. `'gemini-free'`) or a custom {@link QuotaConfig} object.
   * When provided, enables proactive budget tracking and KeyCooldownError on exhaustion.
   */
  quotas?: ProviderPreset | QuotaConfig

  /**
   * Health monitoring configuration. Set to `false` to disable health monitoring.
   * Defaults to `{}` (health monitoring enabled with default settings).
   */
  health?: HealthConfig | false

  /**
   * Custom token counter function. Called with the request body to estimate
   * tokens for budget tracking purposes. Defaults to a char-count heuristic.
   */
  tokenCounter?: TokenCounter
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
  readonly #smartScheduler?: SmartScheduler

  constructor(config: KeyPoolConfig) {
    const { baseURL, strategy, maxRetries, openaiOptions } = config
    const rawKeys = typeof config.keys === 'string' ? config.keys.split(',') : config.keys

    if (!rawKeys || rawKeys.length === 0) {
      throw new Error('KeyPool requires at least one API key in `keys`')
    }
    const validKeys = rawKeys
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter((k) => k !== '')
    if (validKeys.length === 0) {
      throw new Error('KeyPool: all keys are empty strings — provide at least one non-empty key')
    }

    // Validate quotas eagerly at construction time — throws descriptive errors for bad config
    const resolvedQuotas = config.quotas !== undefined ? resolveQuotas(config.quotas) : undefined

    const scheduler = new KeyScheduler(validKeys, strategy)

    super({
      // The OpenAI SDK v6 calls this function before every request, including retries.
      // Combined with maxRetries = keys.length, each retry automatically uses the next key.
      // Smart path: read key from ALS (set by prepareOptions override).
      // Fallback: round-robin/LRU (v0.1.x behavior).
      apiKey: () => {
        if (config.quotas) {
          const store = RequestContext.getStore()
          if (store?.key) return Promise.resolve(store.key)
        }
        return Promise.resolve(scheduler.nextKey())
      },
      baseURL,
      maxRetries: maxRetries ?? validKeys.length,
      ...(openaiOptions as object),
    } as ClientOptions)

    this.#keys = [...validKeys]
    this.#config = config

    // Build SmartScheduler if quotas are configured
    if (resolvedQuotas !== undefined) {
      const estimator = createTokenEstimator(config.tokenCounter)
      const healthMonitor =
        config.health === false
          ? NULL_HEALTH_MONITOR
          : new HealthMonitor(validKeys, config.health ?? {})
      const budgetTracker = new BudgetTracker(resolvedQuotas, validKeys)
      this.#smartScheduler = new SmartScheduler(validKeys, resolvedQuotas, {
        budgetTracker,
        healthMonitor,
        estimator,
        fallbackScheduler: scheduler,
      })
    }

    // Override makeRequest (declared private in TS but accessible in JS at runtime).
    // This is the single interception point for all SDK methods (.chat, .embeddings, etc.).
    // We catch the final RateLimitError after all retries and wrap it as KeyPoolExhaustedError.
    // biome-ignore lint/suspicious/noExplicitAny: runtime access to private method unavailable in TS type system
    const proto = this as unknown as any
    const originalMakeRequest: (...args: unknown[]) => Promise<unknown> =
      // biome-ignore lint/complexity/useLiteralKeys: makeRequest is private in TS — bracket notation required
      proto['makeRequest'].bind(this)
    // biome-ignore lint/complexity/useLiteralKeys: makeRequest is private in TS — bracket notation required
    proto['makeRequest'] = async (...args: unknown[]) => {
      if (this.#smartScheduler) {
        const store: { key: string | undefined; estimatedTokens: number | undefined } = {
          key: undefined,
          estimatedTokens: undefined,
        }
        return RequestContext.run(store, async () => {
          try {
            const result = await originalMakeRequest(...args)
            // REQ-7.3: feed actual token usage back to budget tracker on success.
            // makeRequest returns { response: Response, ... } — clone to read usage
            // without consuming the body that the SDK still needs to parse.
            if (store.key) {
              const key = store.key
              extractUsageFromResult(result).then((actualTokens) => {
                // biome-ignore lint/style/noNonNullAssertion: #smartScheduler is checked above in the if block
                this.#smartScheduler!.recordOutcome(
                  key,
                  actualTokens ?? store.estimatedTokens ?? 0,
                  true,
                )
              })
            }
            return result
          } catch (error) {
            if (error instanceof KeyCooldownError) {
              // Proactive rejection — propagate as-is, do NOT call onExhausted
              throw error
            }
            if (error instanceof OpenAI.RateLimitError) {
              if (store.key) {
                const dimension = parse429Dimension(error.headers)
                const duration = parse429Duration(error.headers)
                // biome-ignore lint/style/noNonNullAssertion: #smartScheduler is checked above in the if block
                this.#smartScheduler!.applyCooldown(store.key, dimension, duration)
              }
              // Reactive path: still throw KeyPoolExhaustedError and call onExhausted
              const maskedKeys = this.#keys.map(maskKey)
              try {
                this.#config.onExhausted?.(maskedKeys)
              } catch {
                // swallow errors thrown inside the user's callback
              }
              throw new KeyPoolExhaustedError(this.#keys, error)
            }
            if (store.key) {
              // biome-ignore lint/style/noNonNullAssertion: #smartScheduler is checked above in the if block
              this.#smartScheduler!.recordOutcome(store.key, 0, false)
            }
            throw error
          }
        })
      }

      // v0.1.x path: no ALS, no smart scheduling
      try {
        return await originalMakeRequest(...args)
      } catch (error) {
        if (error instanceof OpenAI.RateLimitError) {
          const maskedKeys = this.#keys.map(maskKey)
          try {
            this.#config.onExhausted?.(maskedKeys)
          } catch {
            // swallow errors thrown inside the user's callback
          }
          throw new KeyPoolExhaustedError(this.#keys, error)
        }
        throw error
      }
    }

    // Task 4.4: Override prepareOptions when smart-pool is active
    if (this.#smartScheduler) {
      const originalPrepareOptions =
        // biome-ignore lint/complexity/useLiteralKeys: prepareOptions is protected in TS
        proto['prepareOptions'].bind(this)
      const scheduler2 = this.#smartScheduler
      // biome-ignore lint/complexity/useLiteralKeys: prepareOptions is protected in TS
      // biome-ignore lint/complexity/useArrowFunction: regular function preserves runtime prototype assignment semantics
      proto['prepareOptions'] = function (options: { body?: Record<string, unknown> }) {
        const body = (options.body ?? {}) as Record<string, unknown>
        const estimatedTokens = scheduler2.estimateTokens(body)
        const key = scheduler2.selectKey(estimatedTokens)

        if (key === null) {
          const retryAfterMs = scheduler2.getMinCooldownRemaining()
          throw new KeyCooldownError(retryAfterMs || 60_000)
        }

        scheduler2.recordRequest(key, estimatedTokens)

        const store = RequestContext.getStore()
        if (store) {
          store.key = key
          store.estimatedTokens = estimatedTokens
        }

        return originalPrepareOptions(options)
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

// ─── Helper functions ────────────────────────────────────────────────────────

function parse429Dimension(
  headers: Headers | Record<string, string | undefined> | undefined,
): QuotaDimension {
  const limitType = getHeader(headers, 'x-ratelimit-limit-type')
  if (limitType === 'tpm' || limitType === 'tokens_per_min') return 'tpm'
  if (limitType === 'rpd' || limitType === 'requests_per_day') return 'rpd'
  if (limitType === 'tpd' || limitType === 'tokens_per_day') return 'tpd'
  return 'rpm'
}

function parse429Duration(
  headers: Headers | Record<string, string | undefined> | undefined,
): number {
  const retryAfter = getHeader(headers, 'retry-after')
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter)
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000)
    }
  }
  return 60_000
}

function getHeader(
  headers: Headers | Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined
  }
  return (headers as Record<string, string | undefined>)[name]
}

async function extractUsageFromResult(result: unknown): Promise<number | undefined> {
  try {
    if (
      result !== null &&
      typeof result === 'object' &&
      'response' in result &&
      result.response instanceof Response
    ) {
      const body = await result.response.clone().json()
      return extractUsageTokens(body)
    }
  } catch {
    // If clone/parse fails, return undefined — caller falls back to estimate
  }
  return undefined
}

function extractUsageTokens(result: unknown): number | undefined {
  if (
    result !== null &&
    typeof result === 'object' &&
    'usage' in result &&
    result.usage !== null &&
    typeof result.usage === 'object'
  ) {
    const usage = result.usage as Record<string, unknown>
    const total = usage.total_tokens
    if (typeof total === 'number') return total
    const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
    const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
    if (prompt > 0 || completion > 0) return prompt + completion
  }
  return undefined
}
