import type { RateLimitError } from 'openai'

/**
 * Masks an API key for safe logging.
 *
 * Shows the first 4 and last 4 characters separated by `...`.
 * Keys shorter than 8 characters are fully masked as `'***'`.
 *
 * @param key - The raw API key to mask.
 * @returns The masked key string, safe to include in logs or error messages.
 *
 * @example
 * maskKey('AIzaSyB1234567890abcdef') // → 'AIza...cdef'
 * maskKey('short')                   // → '***'
 */
export function maskKey(key: string): string {
  if (key.length < 8) return '***'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

/**
 * Thrown when all keys in the pool have been rate-limited
 * after exhausting all retry attempts.
 *
 * @example
 * try {
 *   await client.chat.completions.create({ ... })
 * } catch (err) {
 *   if (err instanceof KeyPoolExhaustedError) {
 *     console.error('All keys exhausted:', err.keys)
 *     // err.cause is the original RateLimitError from the OpenAI SDK
 *   }
 * }
 */
export class KeyPoolExhaustedError extends Error {
  override readonly name = 'KeyPoolExhaustedError'

  /**
   * All keys that were tried, **masked** (e.g. `'AIza...cdef'`).
   * Safe to log or display in a UI.
   */
  readonly keys: string[]

  /**
   * The original `RateLimitError` thrown by the OpenAI SDK
   * on the last retry attempt.
   */
  override readonly cause: RateLimitError

  constructor(rawKeys: string[], cause: RateLimitError) {
    const masked = rawKeys.map(maskKey)
    super(`All ${masked.length} API keys are rate-limited`)
    this.keys = masked
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
