import { describe, expect, it } from 'vitest'
import { PRESETS, resolveQuotas } from './presets'
import type { QuotaConfig } from './types'

describe('PRESETS', () => {
  it('PRESETS["gemini-free"] is accessible directly', () => {
    expect(PRESETS['gemini-free']).toBeDefined()
    expect(PRESETS['gemini-free'].rpm).toBe(15)
  })
})

describe('resolveQuotas — presets', () => {
  it('gemini-free → { rpm: 15, rpd: 1500, dailyResetHour: 7 }', () => {
    expect(resolveQuotas('gemini-free')).toEqual({ rpm: 15, rpd: 1500, dailyResetHour: 7 })
  })

  it('openai-tier-1 → { rpm: 60, tpm: 60000, dailyResetHour: 7 }', () => {
    expect(resolveQuotas('openai-tier-1')).toEqual({ rpm: 60, tpm: 60_000, dailyResetHour: 7 })
  })

  it('openai-tier-2 → { rpm: 3500, tpm: 90000, dailyResetHour: 7 }', () => {
    expect(resolveQuotas('openai-tier-2')).toEqual({ rpm: 3_500, tpm: 90_000, dailyResetHour: 7 })
  })

  it('groq-free → { rpm: 30, rpd: 14400, dailyResetHour: 7 }', () => {
    expect(resolveQuotas('groq-free')).toEqual({ rpm: 30, rpd: 14_400, dailyResetHour: 7 })
  })

  it('openrouter-free → { rpm: 20, rpd: 200, dailyResetHour: 7 }', () => {
    expect(resolveQuotas('openrouter-free')).toEqual({ rpm: 20, rpd: 200, dailyResetHour: 7 })
  })

  it('unknown preset throws with valid names listed', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => resolveQuotas('unknown-preset' as any)).toThrow(/gemini-free/)
  })
})

describe('resolveQuotas — custom QuotaConfig', () => {
  it('Custom { rpm: 100 } → { rpm: 100, dailyResetHour: 7 }', () => {
    const config: QuotaConfig = { rpm: 100 }
    expect(resolveQuotas(config)).toEqual({ rpm: 100, dailyResetHour: 7 })
  })

  it('Custom { rpm: 100, tpm: 50000 } → { rpm: 100, tpm: 50000, dailyResetHour: 7 }', () => {
    const config: QuotaConfig = { rpm: 100, tpm: 50_000 }
    expect(resolveQuotas(config)).toEqual({ rpm: 100, tpm: 50_000, dailyResetHour: 7 })
  })

  it('unknown string preset throws', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => resolveQuotas('not-a-preset' as any)).toThrow()
  })

  it('missing rpm in custom throws', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input — rpm is required
    expect(() => resolveQuotas({ tpm: 1000 } as any)).toThrow(/rpm/)
  })

  it('Custom with explicit dailyResetHour: 0 → preserved (not overridden to 7)', () => {
    const config: QuotaConfig = { rpm: 100, dailyResetHour: 0 }
    expect(resolveQuotas(config)).toEqual({ rpm: 100, dailyResetHour: 0 })
  })
})
