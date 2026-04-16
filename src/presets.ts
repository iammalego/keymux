import type { ProviderPreset, QuotaConfig } from './types'

/**
 * Built-in quota presets for common providers.
 * Values reflect free-tier or low-tier public limits.
 */
export const PRESETS: Record<ProviderPreset, Omit<QuotaConfig, 'dailyResetHour'>> = {
  'gemini-free': { rpm: 15, rpd: 1500 },
  'openai-tier-1': { rpm: 60, tpm: 60_000 },
  'openai-tier-2': { rpm: 3_500, tpm: 90_000 },
  'groq-free': { rpm: 30, rpd: 14_400 },
  'openrouter-free': { rpm: 20, rpd: 200 },
}

const VALID_PRESETS = Object.keys(PRESETS) as ProviderPreset[]

const DEFAULT_DAILY_RESET_HOUR = 7

/**
 * Resolves a quota configuration from either a named preset or a custom config object.
 *
 * When a custom config is provided:
 * - `rpm` is required.
 * - `dailyResetHour` defaults to `7` (midnight PT) if not explicitly provided.
 *
 * @param input - A named preset string or a custom {@link QuotaConfig} object.
 * @returns A fully resolved {@link QuotaConfig}.
 *
 * @throws {Error} If a string preset name is unknown.
 * @throws {Error} If a custom config is missing the required `rpm` field.
 *
 * @example
 * resolveQuotas('gemini-free')
 * // → { rpm: 15, rpd: 1500, dailyResetHour: 7 }
 *
 * resolveQuotas({ rpm: 100, tpm: 50_000 })
 * // → { rpm: 100, tpm: 50_000, dailyResetHour: 7 }
 */
export function resolveQuotas(input: ProviderPreset | QuotaConfig): QuotaConfig {
  if (typeof input === 'string') {
    if (!VALID_PRESETS.includes(input)) {
      throw new Error(`Unknown preset "${input}". Valid presets: ${VALID_PRESETS.join(', ')}`)
    }
    return { ...PRESETS[input], dailyResetHour: DEFAULT_DAILY_RESET_HOUR }
  }

  if (typeof input !== 'object' || input === null || typeof input.rpm !== 'number') {
    throw new Error('resolveQuotas: custom QuotaConfig must include a numeric `rpm` field')
  }

  return {
    ...input,
    dailyResetHour: input.dailyResetHour ?? DEFAULT_DAILY_RESET_HOUR,
  }
}
