import type { CircuitState, Clock, HealthConfig, HealthState } from './types'

interface KeyHealth {
  state: CircuitState
  failures: number[] // timestamps
  openUntil: number
  currentCooldownMs: number
  consecutiveTrips: number
}

export class HealthMonitor {
  readonly #windowSize: number
  readonly #threshold: number
  readonly #baseCooldownMs: number
  readonly #maxCooldownMs: number
  readonly #clock: Clock
  readonly #health: Map<string, KeyHealth>

  constructor(keys: string[], config?: HealthConfig, clock: Clock = Date.now) {
    this.#windowSize = config?.windowSize ?? 60_000
    this.#threshold = config?.threshold ?? 3
    this.#baseCooldownMs = config?.cooldownMs ?? 60_000
    this.#maxCooldownMs = config?.maxCooldownMs ?? 300_000
    this.#clock = clock
    this.#health = new Map()
    for (const key of keys) {
      this.#health.set(key, this.#createHealth())
    }
  }

  isAvailable(key: string): boolean {
    const health = this.#getOrCreate(key)
    const now = this.#clock()

    if (health.state === 'OPEN') {
      if (now >= health.openUntil) {
        health.state = 'HALF_OPEN'
        return true
      }
      return false
    }

    // CLOSED or HALF_OPEN
    return true
  }

  recordSuccess(key: string): void {
    const health = this.#getOrCreate(key)
    health.state = 'CLOSED'
    health.failures = []
    health.consecutiveTrips = 0
    health.currentCooldownMs = this.#baseCooldownMs
  }

  recordFailure(key: string): void {
    const health = this.#getOrCreate(key)
    const now = this.#clock()

    if (health.state === 'OPEN') {
      // No-op while OPEN
      return
    }

    if (health.state === 'HALF_OPEN') {
      // Failing from HALF_OPEN: double cooldown and reopen
      health.consecutiveTrips++
      const newCooldown = Math.min(health.currentCooldownMs * 2, this.#maxCooldownMs)
      health.currentCooldownMs = newCooldown
      health.openUntil = now + newCooldown
      health.state = 'OPEN'
      return
    }

    // CLOSED: push failure timestamp, evict stale, check threshold
    health.failures.push(now)
    const windowStart = now - this.#windowSize
    health.failures = health.failures.filter((ts) => ts > windowStart)

    if (health.failures.length >= this.#threshold) {
      health.state = 'OPEN'
      health.currentCooldownMs = this.#baseCooldownMs
      health.openUntil = now + this.#baseCooldownMs
    }
  }

  getHealthScore(key: string): number {
    const health = this.#getOrCreate(key)
    const now = this.#clock()

    // Check if OPEN can transition to HALF_OPEN
    if (health.state === 'OPEN') {
      if (now >= health.openUntil) {
        health.state = 'HALF_OPEN'
        return 0.5
      }
      return 0.0
    }

    if (health.state === 'HALF_OPEN') {
      return 0.5
    }

    // CLOSED: score based on recent failures
    const windowStart = now - this.#windowSize
    const recentFailures = health.failures.filter((ts) => ts > windowStart).length
    return Math.max(0, 1.0 - recentFailures / this.#threshold)
  }

  getHealthState(key: string): HealthState {
    const health = this.#getOrCreate(key)
    const now = this.#clock()
    const windowStart = now - this.#windowSize
    const recentFailures = health.failures.filter((ts) => ts > windowStart).length

    return {
      state: health.state,
      failureCount: recentFailures,
      score: this.getHealthScore(key),
      currentCooldownMs: health.currentCooldownMs,
    }
  }

  #createHealth(): KeyHealth {
    return {
      state: 'CLOSED',
      failures: [],
      openUntil: 0,
      currentCooldownMs: this.#baseCooldownMs,
      consecutiveTrips: 0,
    }
  }

  #getOrCreate(key: string): KeyHealth {
    let health = this.#health.get(key)
    if (!health) {
      health = this.#createHealth()
      this.#health.set(key, health)
    }
    return health
  }
}

// Null Object Pattern for health: false
export const NULL_HEALTH_MONITOR: Pick<
  HealthMonitor,
  'isAvailable' | 'recordSuccess' | 'recordFailure' | 'getHealthScore' | 'getHealthState'
> = {
  isAvailable: () => true,
  recordSuccess: () => {},
  recordFailure: () => {},
  getHealthScore: () => 1.0,
  getHealthState: () => ({
    state: 'CLOSED' as const,
    failureCount: 0,
    score: 1.0,
    currentCooldownMs: 0,
  }),
}
