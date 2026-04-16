import { describe, expect, it } from 'vitest'
import { KeyCooldownError, KeyPoolExhaustedError, maskKey } from './errors'

describe('maskKey', () => {
  it('masks a standard key showing first 4 and last 4 chars', () => {
    expect(maskKey('sk-test-key-12345678')).toBe('sk-t...5678')
  })
  it('masks exactly 8-char key (not fully masked)', () => {
    expect(maskKey('12345678')).toBe('1234...5678')
  })
  it('returns "***" for key shorter than 8 chars', () => {
    expect(maskKey('short')).toBe('***')
  })
  it('returns "***" for a 7-char key', () => {
    expect(maskKey('1234567')).toBe('***')
  })
  it('returns "***" for empty string', () => {
    expect(maskKey('')).toBe('***')
  })
})

describe('KeyCooldownError', () => {
  const err = new KeyCooldownError(90_000)

  it('extends Error', () => {
    expect(err).toBeInstanceOf(Error)
  })
  it('has name "KeyCooldownError"', () => {
    expect(err.name).toBe('KeyCooldownError')
  })
  it('stores retryAfterMs correctly', () => {
    expect(err.retryAfterMs).toBe(90_000)
  })
  it('is instanceof KeyCooldownError', () => {
    expect(err).toBeInstanceOf(KeyCooldownError)
  })
  it('message contains retry seconds (ceiled)', () => {
    // 90_000 ms → 90 s
    expect(err.message).toContain('90s')
  })
  it('message contains retry seconds for fractional ms', () => {
    const err2 = new KeyCooldownError(61_500)
    // 61_500 ms → ceil(61.5) = 62 s
    expect(err2.message).toContain('62s')
  })
})

describe('KeyPoolExhaustedError', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test fixture — RateLimitError constructor not easily instantiable
  const cause = new Error('original') as any
  const err = new KeyPoolExhaustedError(['sk-key-aaa', 'sk-key-bbb'], cause)

  it('has name "KeyPoolExhaustedError"', () => {
    expect(err.name).toBe('KeyPoolExhaustedError')
  })
  it('formats message with key count', () => {
    expect(err.message).toBe('All 2 API keys are rate-limited')
  })
  it('stores masked keys (not raw keys)', () => {
    expect(err.keys).toHaveLength(2)
    expect(err.keys[0]).toContain('...')
    expect(err.keys[0]).not.toBe('sk-key-aaa')
  })
  it('stores the original error as cause', () => {
    expect(err.cause).toBe(cause)
  })
  it('is instanceof Error', () => {
    expect(err).toBeInstanceOf(Error)
  })
  it('is instanceof KeyPoolExhaustedError', () => {
    expect(err).toBeInstanceOf(KeyPoolExhaustedError)
  })
})
