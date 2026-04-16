import type { BudgetTracker } from './budget-tracker'
import type { HealthMonitor } from './health-monitor'
import type { KeyScheduler } from './scheduler'
import type { QuotaConfig, QuotaDimension } from './types'

// Use Pick<> for the health monitor interface so it works with both real and NULL_HEALTH_MONITOR
type HealthMonitorLike = Pick<
  HealthMonitor,
  'isAvailable' | 'recordSuccess' | 'recordFailure' | 'getHealthScore'
>

export class SmartScheduler {
  readonly #keys: string[]
  readonly #quotas: QuotaConfig
  readonly #budget: BudgetTracker
  readonly #health: HealthMonitorLike
  readonly #estimator: (body: Record<string, unknown>) => number

  constructor(
    keys: string[],
    quotas: QuotaConfig,
    deps: {
      budgetTracker: BudgetTracker
      healthMonitor: HealthMonitorLike
      estimator: (body: Record<string, unknown>) => number
      // fallbackScheduler is part of the public API for KeyPool integration
      // but SmartScheduler always uses its own logic — kept in the interface for future use
      fallbackScheduler: KeyScheduler
    },
  ) {
    this.#keys = keys
    this.#quotas = quotas
    this.#budget = deps.budgetTracker
    this.#health = deps.healthMonitor
    this.#estimator = deps.estimator
  }

  selectKey(estimatedTokens: number): string | null {
    // Stage 1: health filter
    const healthy = this.#keys.filter((k) => this.#health.isAvailable(k))
    if (healthy.length === 0) return null

    // Stage 2: budget filter
    const affordable = healthy.filter((k) => this.#budget.canAccommodate(k, estimatedTokens))
    if (affordable.length === 0) return null

    // Stage 3: single key shortcut
    // biome-ignore lint/style/noNonNullAssertion: length === 1 guarantees index 0 exists
    if (affordable.length === 1) return affordable[0]!

    // Stage 4: tie-break by utilization
    // Primary: lowest TPM% (or 0 if no tpm configured)
    // Secondary: lowest RPM%
    // Tertiary: pool order (index in this.#keys)
    const scored = affordable.map((key) => {
      const state = this.#budget.getBudgetState(key)
      const tpmUtil = this.#quotas.tpm ? state.tpmUsed / this.#quotas.tpm : 0
      const rpmUtil = state.rpmUsed / this.#quotas.rpm
      const poolIndex = this.#keys.indexOf(key)
      return { key, tpmUtil, rpmUtil, poolIndex }
    })

    scored.sort(
      (a, b) => a.tpmUtil - b.tpmUtil || a.rpmUtil - b.rpmUtil || a.poolIndex - b.poolIndex,
    )

    // biome-ignore lint/style/noNonNullAssertion: scored is non-empty (affordable.length >= 2 at this point)
    return scored[0]!.key
  }

  recordOutcome(key: string, actualTokens: number, success: boolean): void {
    this.#budget.recordActual(key, actualTokens)
    if (success) {
      this.#health.recordSuccess(key)
    } else {
      this.#health.recordFailure(key)
    }
  }

  applyCooldown(key: string, dimension: QuotaDimension, durationMs: number): void {
    this.#budget.applyCooldown(key, dimension, durationMs)
  }

  estimateTokens(body: Record<string, unknown>): number {
    return this.#estimator(body)
  }

  recordRequest(key: string, estimatedTokens: number): void {
    this.#budget.recordRequest(key, estimatedTokens)
  }

  getMinCooldownRemaining(): number {
    return this.#budget.getMinCooldownRemaining()
  }
}
