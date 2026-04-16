import type { BudgetState, Clock, QuotaConfig, QuotaDimension, WindowEntry } from './types'

// Internal per-key state
interface KeyBudget {
  rpm: WindowEntry[]
  tpm: WindowEntry[]
  rpd: WindowEntry[]
  tpd: WindowEntry[]
  lastTokenEntryIndex: number
  cooldownUntil: Record<QuotaDimension, number>
}

export class BudgetTracker {
  readonly #quotas: QuotaConfig
  readonly #dailyResetHour: number
  readonly #clock: Clock
  readonly #budgets: Map<string, KeyBudget>

  constructor(quotas: QuotaConfig, keys: string[], clock: Clock = Date.now) {
    this.#quotas = quotas
    this.#dailyResetHour = quotas.dailyResetHour ?? 7
    this.#clock = clock
    this.#budgets = new Map()
    for (const key of keys) {
      this.#budgets.set(key, this.#createBudget())
    }
  }

  canAccommodate(key: string, estimatedTokens: number): boolean {
    const budget = this.#getOrCreate(key)
    const now = this.#clock()

    this.#evictStale(budget, now)

    // Check cooldowns first — any active dimension blocks the key
    for (const dim of ['rpm', 'tpm', 'rpd', 'tpd'] as QuotaDimension[]) {
      if (budget.cooldownUntil[dim] > now) {
        return false
      }
    }

    // Check rpm
    if (this.#quotas.rpm !== undefined) {
      if (budget.rpm.length >= this.#quotas.rpm) {
        return false
      }
    }

    // Check tpm
    if (this.#quotas.tpm !== undefined) {
      const tpmSum = budget.tpm.reduce((sum, e) => sum + e.value, 0)
      if (tpmSum + estimatedTokens > this.#quotas.tpm) {
        return false
      }
    }

    // Check rpd
    if (this.#quotas.rpd !== undefined) {
      if (budget.rpd.length >= this.#quotas.rpd) {
        return false
      }
    }

    // Check tpd
    if (this.#quotas.tpd !== undefined) {
      const tpdSum = budget.tpd.reduce((sum, e) => sum + e.value, 0)
      if (tpdSum + estimatedTokens > this.#quotas.tpd) {
        return false
      }
    }

    return true
  }

  recordRequest(key: string, estimatedTokens: number): void {
    const budget = this.#getOrCreate(key)
    const now = this.#clock()

    budget.rpm.push({ ts: now, value: 1 })
    budget.lastTokenEntryIndex = budget.tpm.length
    budget.tpm.push({ ts: now, value: estimatedTokens })
    budget.rpd.push({ ts: now, value: 1 })
    budget.tpd.push({ ts: now, value: estimatedTokens })
  }

  recordActual(key: string, actualTokens: number): void {
    const budget = this.#getOrCreate(key)
    const idx = budget.lastTokenEntryIndex

    if (idx < 0 || idx >= budget.tpm.length) {
      return
    }

    const tpmEntry = budget.tpm[idx]
    if (tpmEntry) {
      tpmEntry.value = actualTokens
    }
    // Also update tpd at the same relative position from end
    const tpdIdx = budget.tpd.length - (budget.tpm.length - idx)
    if (tpdIdx >= 0 && tpdIdx < budget.tpd.length) {
      const tpdEntry = budget.tpd[tpdIdx]
      if (tpdEntry) {
        tpdEntry.value = actualTokens
      }
    }
  }

  applyCooldown(key: string, dimension: QuotaDimension, durationMs: number): void {
    const budget = this.#getOrCreate(key)
    const now = this.#clock()
    budget.cooldownUntil[dimension] = now + durationMs
  }

  getBudgetState(key: string): BudgetState {
    const budget = this.#getOrCreate(key)
    const now = this.#clock()
    this.#evictStale(budget, now)

    return {
      rpmUsed: budget.rpm.length,
      tpmUsed: budget.tpm.reduce((sum, e) => sum + e.value, 0),
      rpdUsed: budget.rpd.length,
      tpdUsed: budget.tpd.reduce((sum, e) => sum + e.value, 0),
    }
  }

  getMinCooldownRemaining(): number {
    const now = this.#clock()
    let min = 0

    for (const budget of this.#budgets.values()) {
      for (const dim of ['rpm', 'tpm', 'rpd', 'tpd'] as QuotaDimension[]) {
        const remaining = budget.cooldownUntil[dim] - now
        if (remaining > 0) {
          if (min === 0 || remaining < min) {
            min = remaining
          }
        }
      }
    }

    return min
  }

  #createBudget(): KeyBudget {
    return {
      rpm: [],
      tpm: [],
      rpd: [],
      tpd: [],
      lastTokenEntryIndex: -1,
      cooldownUntil: { rpm: 0, tpm: 0, rpd: 0, tpd: 0 },
    }
  }

  #getOrCreate(key: string): KeyBudget {
    let budget = this.#budgets.get(key)
    if (!budget) {
      budget = this.#createBudget()
      this.#budgets.set(key, budget)
    }
    return budget
  }

  #evictStale(budget: KeyBudget, now: number): void {
    const minuteAgo = now - 60_000
    const dailyReset = this.#getLastDailyReset(now)

    budget.rpm = budget.rpm.filter((e) => e.ts > minuteAgo)
    budget.tpm = budget.tpm.filter((e) => e.ts > minuteAgo)
    budget.rpd = budget.rpd.filter((e) => e.ts >= dailyReset)
    budget.tpd = budget.tpd.filter((e) => e.ts >= dailyReset)

    // Recalculate lastTokenEntryIndex after eviction
    budget.lastTokenEntryIndex = budget.tpm.length - 1
  }

  #getLastDailyReset(now: number): number {
    const date = new Date(now)
    const todayReset = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      this.#dailyResetHour,
    )
    return now >= todayReset ? todayReset : todayReset - 86_400_000
  }
}
