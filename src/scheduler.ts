/**
 * Key rotation strategy.
 * - 'round-robin': Cycle through keys sequentially. O(1). Deterministic.
 * - 'least-recently-used': Return key with oldest lastUsedAt timestamp. O(N).
 *   Best for Gemini free tier — maximizes time between reuses.
 */
export type Strategy = 'round-robin' | 'least-recently-used'

/**
 * Pure key rotation scheduler. No SDK dependency.
 * Internal implementation detail — NOT exported from the package.
 */
export class KeyScheduler {
  readonly #keys: string[]
  readonly #strategy: Strategy
  #index = 0
  readonly #lastUsedAt: Map<string, number>

  constructor(keys: string[], strategy: Strategy = 'round-robin') {
    const valid = keys.filter(k => k.trim() !== '')
    if (valid.length === 0) {
      throw new Error('KeyScheduler requires at least one non-empty key')
    }
    this.#keys = valid
    this.#strategy = strategy
    // Initialize with array index so LRU tie-breaks by lower index (index 0 wins first)
    this.#lastUsedAt = new Map(valid.map((key, i) => [key, i]))
  }

  nextKey(): string {
    if (this.#strategy === 'round-robin') {
      return this.#nextRoundRobin()
    }
    return this.#nextLRU()
  }

  #nextRoundRobin(): string {
    const key = this.#keys[this.#index]!
    this.#index = (this.#index + 1) % this.#keys.length
    return key
  }

  #nextLRU(): string {
    let oldestKey = this.#keys[0]!
    let oldestTime = this.#lastUsedAt.get(oldestKey)!
    for (let i = 1; i < this.#keys.length; i++) {
      const key = this.#keys[i]!
      const t = this.#lastUsedAt.get(key)!
      if (t < oldestTime) {
        oldestTime = t
        oldestKey = key
      }
    }
    this.#lastUsedAt.set(oldestKey, Date.now())
    return oldestKey
  }

  get size(): number {
    return this.#keys.length
  }
}
