import { beforeEach, describe, expect, it } from 'vitest'
import { BudgetTracker } from './budget-tracker'
import type { Clock } from './types'

let now = 1_000_000
const clock: Clock = () => now
const advance = (ms: number) => {
  now += ms
}

beforeEach(() => {
  now = 1_000_000
})

describe('BudgetTracker — canAccommodate', () => {
  it('SCENARIO-2.1: fresh key with rpm:15 → canAccommodate returns true', () => {
    const tracker = new BudgetTracker({ rpm: 15 }, ['key-A'], clock)
    expect(tracker.canAccommodate('key-A', 100)).toBe(true)
  })

  it('SCENARIO-2.2: rpm:15, 15 requests within 60s → canAccommodate returns false', () => {
    const tracker = new BudgetTracker({ rpm: 15 }, ['key-A'], clock)
    for (let i = 0; i < 15; i++) {
      tracker.recordRequest('key-A', 100)
    }
    expect(tracker.canAccommodate('key-A', 100)).toBe(false)
  })

  it('SCENARIO-2.3: rpm:15, 15 requests at T=0, advance(61_000) → canAccommodate returns true (window slid)', () => {
    const tracker = new BudgetTracker({ rpm: 15 }, ['key-A'], clock)
    for (let i = 0; i < 15; i++) {
      tracker.recordRequest('key-A', 100)
    }
    advance(61_000)
    expect(tracker.canAccommodate('key-A', 100)).toBe(true)
  })

  it('SCENARIO-2.4: tpm:1000, two recordRequest(500) → canAccommodate(1) returns false', () => {
    const tracker = new BudgetTracker({ rpm: 100, tpm: 1000 }, ['key-A'], clock)
    tracker.recordRequest('key-A', 500)
    tracker.recordRequest('key-A', 500)
    expect(tracker.canAccommodate('key-A', 1)).toBe(false)
  })

  it('SCENARIO-2.5: tpm:1000, recordRequest(900) then recordActual(200) → canAccommodate(500) returns true', () => {
    const tracker = new BudgetTracker({ rpm: 100, tpm: 1000 }, ['key-A'], clock)
    tracker.recordRequest('key-A', 900)
    tracker.recordActual('key-A', 200)
    // 200 + 500 = 700 < 1000
    expect(tracker.canAccommodate('key-A', 500)).toBe(true)
  })

  it('SCENARIO-2.6: rpm:100, applyCooldown("rpm", 60000) → canAccommodate returns false', () => {
    const tracker = new BudgetTracker({ rpm: 100 }, ['key-A'], clock)
    tracker.applyCooldown('key-A', 'rpm', 60_000)
    expect(tracker.canAccommodate('key-A', 100)).toBe(false)
  })

  it('SCENARIO-2.7: applyCooldown at T=0, advance(60001) → canAccommodate returns true', () => {
    const tracker = new BudgetTracker({ rpm: 100 }, ['key-A'], clock)
    tracker.applyCooldown('key-A', 'rpm', 60_000)
    advance(60_001)
    expect(tracker.canAccommodate('key-A', 100)).toBe(true)
  })

  it('SCENARIO-2.8: rpd:100 + rpm:15, applyCooldown("rpd", 86400000), 0 RPM usage → canAccommodate false (RPD blocks)', () => {
    const tracker = new BudgetTracker({ rpm: 15, rpd: 100 }, ['key-A'], clock)
    tracker.applyCooldown('key-A', 'rpd', 86_400_000)
    expect(tracker.canAccommodate('key-A', 100)).toBe(false)
  })

  it('SCENARIO-2.9: no tpm configured (only rpm), 10000 token requests → canAccommodate true (tpm not tracked)', () => {
    const tracker = new BudgetTracker({ rpm: 100 }, ['key-A'], clock)
    tracker.recordRequest('key-A', 10_000)
    expect(tracker.canAccommodate('key-A', 10_000)).toBe(true)
  })

  it('SCENARIO-2.10: dailyResetHour:7, full RPD, clock just before 07:00 UTC, advance past 07:00 → canAccommodate true', () => {
    // Set clock to 06:59:59 UTC — 1ms before reset
    // 2024-01-15 06:59:59 UTC in ms
    const dayMs = Date.UTC(2024, 0, 15, 6, 59, 59, 0)
    let dynamicNow = dayMs
    const dynamicClock: Clock = () => dynamicNow

    const tracker = new BudgetTracker(
      { rpm: 100, rpd: 5, dailyResetHour: 7 },
      ['key-A'],
      dynamicClock,
    )
    // Exhaust RPD
    for (let i = 0; i < 5; i++) {
      tracker.recordRequest('key-A', 10)
    }
    expect(tracker.canAccommodate('key-A', 10)).toBe(false)

    // Advance past 07:00 UTC
    dynamicNow = Date.UTC(2024, 0, 15, 7, 0, 1, 0)
    expect(tracker.canAccommodate('key-A', 10)).toBe(true)
  })

  it('SCENARIO-2.11: tpm:500, recordRequest(200) → canAccommodate(200) true (400 < 500)', () => {
    const tracker = new BudgetTracker({ rpm: 100, tpm: 500 }, ['key-A'], clock)
    tracker.recordRequest('key-A', 200)
    expect(tracker.canAccommodate('key-A', 200)).toBe(true)
  })
})

describe('BudgetTracker — extra scenarios', () => {
  it('recordActual with no prior recordRequest → no crash', () => {
    const tracker = new BudgetTracker({ rpm: 100 }, ['key-A'], clock)
    expect(() => tracker.recordActual('key-A', 500)).not.toThrow()
  })

  it('getBudgetState returns correct counts', () => {
    const tracker = new BudgetTracker({ rpm: 100, tpm: 1000, rpd: 50, tpd: 5000 }, ['key-A'], clock)
    tracker.recordRequest('key-A', 300)
    tracker.recordRequest('key-A', 200)
    const state = tracker.getBudgetState('key-A')
    expect(state.rpmUsed).toBe(2)
    expect(state.tpmUsed).toBe(500)
    expect(state.rpdUsed).toBe(2)
    expect(state.tpdUsed).toBe(500)
  })

  it('getMinCooldownRemaining returns 0 with no cooldowns', () => {
    const tracker = new BudgetTracker({ rpm: 100 }, ['key-A'], clock)
    expect(tracker.getMinCooldownRemaining()).toBe(0)
  })

  it('getMinCooldownRemaining returns remaining ms when cooldown active', () => {
    const tracker = new BudgetTracker({ rpm: 100 }, ['key-A'], clock)
    tracker.applyCooldown('key-A', 'rpm', 30_000)
    // now = 1_000_000, cooldownUntil = 1_030_000, remaining = 30_000
    expect(tracker.getMinCooldownRemaining()).toBe(30_000)
  })

  it('multiple keys tracked independently', () => {
    const tracker = new BudgetTracker({ rpm: 2 }, ['key-A', 'key-B'], clock)
    tracker.recordRequest('key-A', 0)
    tracker.recordRequest('key-A', 0)
    // key-A is exhausted, key-B is not
    expect(tracker.canAccommodate('key-A', 0)).toBe(false)
    expect(tracker.canAccommodate('key-B', 0)).toBe(true)
  })

  it('applyCooldown "tpm" blocks only tpm dimension, not rpm', () => {
    const tracker = new BudgetTracker({ rpm: 10, tpm: 1000 }, ['key-A'], clock)
    tracker.applyCooldown('key-A', 'tpm', 60_000)
    // tpm is blocked but canAccommodate checks all dims — tpm cooldown → false
    expect(tracker.canAccommodate('key-A', 100)).toBe(false)
    // Now expire the cooldown and check with rpm still fine
    advance(60_001)
    expect(tracker.canAccommodate('key-A', 100)).toBe(true)
  })
})
