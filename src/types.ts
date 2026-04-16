export interface QuotaConfig {
  rpm: number
  tpm?: number
  rpd?: number
  tpd?: number
  dailyResetHour?: number
}

export type ProviderPreset =
  | 'gemini-free'
  | 'openai-tier-1'
  | 'openai-tier-2'
  | 'groq-free'
  | 'openrouter-free'

export interface HealthConfig {
  windowSize?: number
  threshold?: number
  cooldownMs?: number
  maxCooldownMs?: number
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'
export type QuotaDimension = 'rpm' | 'tpm' | 'rpd' | 'tpd'

export interface WindowEntry {
  ts: number
  value: number
}

export type Clock = () => number

export interface BudgetState {
  rpmUsed: number
  tpmUsed: number
  rpdUsed: number
  tpdUsed: number
}

export interface HealthState {
  state: CircuitState
  failureCount: number
  score: number
  currentCooldownMs: number
}
