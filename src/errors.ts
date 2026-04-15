import type { RateLimitError } from 'openai'

/**
 * Mask an API key for safe logging: shows first 4 + last 4 chars.
 * Keys shorter than 8 chars are fully masked as '***'.
 */
export function maskKey(key: string): string {
  if (key.length < 8) return '***'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

/**
 * Thrown when all keys in the pool have been rate-limited
 * after exhausting all retry attempts.
 */
export class KeyPoolExhaustedError extends Error {
  override readonly name = 'KeyPoolExhaustedError'
  readonly keys: string[]
  override readonly cause: RateLimitError

  constructor(rawKeys: string[], cause: RateLimitError) {
    const masked = rawKeys.map(maskKey)
    super(`All ${masked.length} API keys are rate-limited`)
    this.keys = masked
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
