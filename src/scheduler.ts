/**
 * Key rotation strategy.
 *
 * - `'round-robin'`: Cycles through keys in order (A → B → C → A → ...). O(1). Deterministic.
 * - `'least-recently-used'`: Always picks the key that was used least recently. O(N).
 *   Recommended for Gemini free tier — maximizes the time window between reuses of the same key.
 */
export type Strategy = 'round-robin' | 'least-recently-used'

/**
 * Pure key rotation scheduler. No SDK dependency.
 *
 * @internal Not exported from the package — use {@link KeyPool} directly.
 */
export class KeyScheduler {
  readonly #keys: string[]
  readonly #strategy: Strategy
  #index = 0
  readonly #lastUsedAt: Map<string, number>

  /**
   * @param keys - Non-empty array of API key strings.
   * @param strategy - Rotation strategy. Defaults to `'round-robin'`.
   * @throws {Error} If `keys` is empty or contains only blank strings.
   */
  constructor(keys: string[], strategy: Strategy = 'round-robin') {
    const valid = keys.filter((k) => k.trim() !== '')
    if (valid.length === 0) {
      throw new Error('KeyScheduler requires at least one non-empty key')
    }
    this.#keys = valid
    this.#strategy = strategy
    // Initialize with array index so LRU tie-breaks by lower index (index 0 wins first call)
    this.#lastUsedAt = new Map(valid.map((key, i) => [key, i]))
  }

  /**
   * Returns the next key to use according to the configured strategy,
   * and advances the internal rotation state.
   *
   * @returns The next API key string.
   */
  nextKey(): string {
    if (this.#strategy === 'round-robin') {
      return this.#nextRoundRobin()
    }
    return this.#nextLRU()
  }

  /** Number of keys in the pool. */
  get size(): number {
    return this.#keys.length
  }

  #nextRoundRobin(): string {
    // biome-ignore lint/style/noNonNullAssertion: index is always in bounds (modulo keys.length)
    const key = this.#keys[this.#index]!
    this.#index = (this.#index + 1) % this.#keys.length
    return key
  }

  #nextLRU(): string {
    // biome-ignore lint/style/noNonNullAssertion: keys array is non-empty (guaranteed by constructor)
    let oldestKey = this.#keys[0]!
    // biome-ignore lint/style/noNonNullAssertion: map is populated from keys array in constructor
    let oldestTime = this.#lastUsedAt.get(oldestKey)!
    for (let i = 1; i < this.#keys.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i < keys.length, always in bounds
      const key = this.#keys[i]!
      // biome-ignore lint/style/noNonNullAssertion: map is populated from keys array in constructor
      const t = this.#lastUsedAt.get(key)!
      if (t < oldestTime) {
        oldestTime = t
        oldestKey = key
      }
    }
    this.#lastUsedAt.set(oldestKey, Date.now())
    return oldestKey
  }
}
