import OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { KeyPoolExhaustedError, maskKey } from './errors'
import { KeyScheduler } from './scheduler'
import type { Strategy } from './scheduler'

export interface KeyPoolConfig {
  /** API keys for rotation — minimum 1, rotation effective with 2+ */
  keys: string[]

  /** Provider base URL. Defaults to OpenAI's URL.
   *  Gemini: 'https://generativelanguage.googleapis.com/v1beta/openai' */
  baseURL?: string

  /** Rotation strategy. Default: 'round-robin' */
  strategy?: Strategy

  /** Max retries before giving up. Default: keys.length (one attempt per key) */
  maxRetries?: number

  /** Called when all keys are exhausted (for alerting) */
  onExhausted?: (maskedKeys: string[]) => void

  /** Pass-through options for the underlying OpenAI client.
   *  Cannot override apiKey or baseURL or maxRetries (managed by KeyPool). */
  openaiOptions?: Omit<ClientOptions, 'apiKey' | 'baseURL' | 'maxRetries'>
}

export class KeyPool extends OpenAI {
  readonly #keys: string[]
  readonly #config: KeyPoolConfig

  constructor(config: KeyPoolConfig) {
    const { keys, baseURL, strategy, maxRetries, openaiOptions } = config

    if (!keys || keys.length === 0) {
      throw new Error('KeyPool requires at least one API key in `keys`')
    }
    const validKeys = keys.filter(k => typeof k === 'string' && k.trim() !== '')
    if (validKeys.length === 0) {
      throw new Error(
        'KeyPool: all keys are empty strings — provide at least one non-empty key',
      )
    }

    const scheduler = new KeyScheduler(validKeys, strategy)

    super({
      apiKey: () => Promise.resolve(scheduler.nextKey()),
      baseURL,
      maxRetries: maxRetries ?? validKeys.length,
      ...(openaiOptions as object),
    } as ClientOptions)

    this.#keys = [...validKeys]
    this.#config = config

    // Override makeRequest (private in TS declarations, but accessible in JS)
    // We wrap the call to intercept final RateLimitError and convert to KeyPoolExhaustedError.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = this as unknown as any
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const originalMakeRequest: (...args: unknown[]) => Promise<unknown> = proto['makeRequest'].bind(
      this,
    )
    const self = this
    proto['makeRequest'] = async function (...args: unknown[]) {
      try {
        return await originalMakeRequest(...args)
      } catch (error) {
        if (error instanceof OpenAI.RateLimitError) {
          const maskedKeys = self.#keys.map(maskKey)
          try {
            self.#config.onExhausted?.(maskedKeys)
          } catch {
            // swallow callback errors
          }
          throw new KeyPoolExhaustedError(self.#keys, error)
        }
        throw error
      }
    }
  }

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
