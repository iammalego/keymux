import { beforeEach, describe, expect, it } from 'vitest'
import { HealthMonitor, NULL_HEALTH_MONITOR } from './health-monitor'
import type { Clock } from './types'

let now = 1_000_000
const clock: Clock = () => now
const advance = (ms: number) => {
  now += ms
}

beforeEach(() => {
  now = 1_000_000
})

describe('HealthMonitor — isAvailable', () => {
  it('SCENARIO-3.1: fresh key → isAvailable true', () => {
    const monitor = new HealthMonitor(['key-A'], undefined, clock)
    expect(monitor.isAvailable('key-A')).toBe(true)
  })

  it('SCENARIO-3.2: threshold=3, 3 failures → isAvailable false (OPEN)', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.isAvailable('key-A')).toBe(false)
  })

  it('SCENARIO-3.3: threshold=3, 2 failures → isAvailable true (still CLOSED)', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.isAvailable('key-A')).toBe(true)
  })

  it('SCENARIO-3.4: OPEN, advance(60001) → isAvailable true (HALF_OPEN)', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3, cooldownMs: 60_000 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    advance(60_001)
    expect(monitor.isAvailable('key-A')).toBe(true)
  })

  it('SCENARIO-3.5: HALF_OPEN, recordSuccess → CLOSED, failures reset', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3, cooldownMs: 60_000 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    advance(60_001)
    // Transition to HALF_OPEN
    expect(monitor.isAvailable('key-A')).toBe(true)
    monitor.recordSuccess('key-A')
    // Should be CLOSED now
    expect(monitor.getHealthState('key-A').state).toBe('CLOSED')
    expect(monitor.getHealthState('key-A').failureCount).toBe(0)
  })

  it('SCENARIO-3.6: HALF_OPEN, recordFailure → OPEN, cooldown doubled (120000)', () => {
    const monitor = new HealthMonitor(
      ['key-A'],
      { threshold: 3, cooldownMs: 60_000, maxCooldownMs: 300_000 },
      clock,
    )
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    advance(60_001)
    // Trigger HALF_OPEN
    monitor.isAvailable('key-A')
    // Fail again from HALF_OPEN
    monitor.recordFailure('key-A')
    // Should be OPEN again
    expect(monitor.getHealthState('key-A').state).toBe('OPEN')
    // Cooldown should be doubled: 60_000 * 2 = 120_000
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(120_000)
  })

  it('SCENARIO-3.7: multiple cycles, maxCooldownMs:300000 → cooldown never exceeds 300000', () => {
    const monitor = new HealthMonitor(
      ['key-A'],
      { threshold: 1, cooldownMs: 60_000, maxCooldownMs: 300_000 },
      clock,
    )

    // Cycle 1: CLOSED → OPEN (60_000)
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(60_000)

    // Advance past cooldown → HALF_OPEN, fail again → OPEN (120_000)
    advance(60_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(120_000)

    // Advance → HALF_OPEN, fail → OPEN (240_000)
    advance(120_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(240_000)

    // Advance → HALF_OPEN, fail → OPEN (300_000 capped)
    advance(240_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(300_000)
  })

  it('SCENARIO-3.8: 2 failures at T=0, advance(61000), 1 new failure → isAvailable true (only 1 in-window)', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3, windowSize: 60_000 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    advance(61_000)
    monitor.recordFailure('key-A')
    // Old 2 failures are outside window, only 1 in-window → still CLOSED
    expect(monitor.isAvailable('key-A')).toBe(true)
  })

  it('SCENARIO-3.9: 2 failures + 1 success → count resets, next single failure does not trip', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    monitor.recordSuccess('key-A')
    // After success, failure count resets
    monitor.recordFailure('key-A')
    expect(monitor.isAvailable('key-A')).toBe(true)
  })

  it('SCENARIO-3.11: getHealthScore — CLOSED/0 failures → 1.0, OPEN → 0.0, HALF_OPEN → 0.5', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 3, cooldownMs: 60_000 }, clock)

    // Fresh key: CLOSED, 0 failures → score 1.0
    expect(monitor.getHealthScore('key-A')).toBe(1.0)

    // 3 failures → OPEN → score 0.0
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthScore('key-A')).toBe(0.0)

    // Advance past cooldown → HALF_OPEN → score 0.5
    advance(60_001)
    monitor.isAvailable('key-A') // triggers state transition
    expect(monitor.getHealthScore('key-A')).toBe(0.5)
  })
})

describe('HealthMonitor — extra scenarios', () => {
  it('First CLOSED→OPEN sets baseCooldownMs (not doubled)', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 1, cooldownMs: 60_000 }, clock)
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(60_000)
  })

  it('Exponential backoff: 60→120→240→300 (capped)', () => {
    const monitor = new HealthMonitor(
      ['key-A'],
      { threshold: 1, cooldownMs: 60_000, maxCooldownMs: 300_000 },
      clock,
    )

    // Trip 1
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(60_000)

    advance(60_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(120_000)

    advance(120_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(240_000)

    advance(240_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(300_000)
  })

  it('consecutiveTrips resets on success', () => {
    const monitor = new HealthMonitor(
      ['key-A'],
      { threshold: 1, cooldownMs: 60_000, maxCooldownMs: 300_000 },
      clock,
    )

    // Trip → cooldown doubles
    monitor.recordFailure('key-A')
    advance(60_001)
    monitor.isAvailable('key-A')
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(120_000)

    // Recover via success
    advance(120_001)
    monitor.isAvailable('key-A')
    monitor.recordSuccess('key-A')

    // Trip again — should start from base cooldown again
    monitor.recordFailure('key-A')
    expect(monitor.getHealthState('key-A').currentCooldownMs).toBe(60_000)
  })

  it('Failure in OPEN state is no-op (does not extend cooldown)', () => {
    const monitor = new HealthMonitor(['key-A'], { threshold: 1, cooldownMs: 60_000 }, clock)
    monitor.recordFailure('key-A')
    const stateAfterOpen = monitor.getHealthState('key-A')

    // Record failure while OPEN — should be ignored
    monitor.recordFailure('key-A')
    const stateAfterNoOp = monitor.getHealthState('key-A')

    // openUntil should not change
    expect(stateAfterNoOp.currentCooldownMs).toBe(stateAfterOpen.currentCooldownMs)
    expect(stateAfterNoOp.state).toBe('OPEN')
  })

  it('Multiple keys tracked independently', () => {
    const monitor = new HealthMonitor(['key-A', 'key-B'], { threshold: 2 }, clock)
    monitor.recordFailure('key-A')
    monitor.recordFailure('key-A')

    expect(monitor.isAvailable('key-A')).toBe(false)
    expect(monitor.isAvailable('key-B')).toBe(true)
  })
})

describe('NULL_HEALTH_MONITOR', () => {
  it('isAvailable always returns true', () => {
    expect(NULL_HEALTH_MONITOR.isAvailable('any-key')).toBe(true)
  })

  it('recordFailure is no-op', () => {
    expect(() => NULL_HEALTH_MONITOR.recordFailure('any-key')).not.toThrow()
  })

  it('recordSuccess is no-op', () => {
    expect(() => NULL_HEALTH_MONITOR.recordSuccess('any-key')).not.toThrow()
  })

  it('getHealthScore always returns 1.0', () => {
    expect(NULL_HEALTH_MONITOR.getHealthScore('any-key')).toBe(1.0)
  })

  it('getHealthState returns CLOSED state with score 1.0', () => {
    const state = NULL_HEALTH_MONITOR.getHealthState('any-key')
    expect(state.state).toBe('CLOSED')
    expect(state.failureCount).toBe(0)
    expect(state.score).toBe(1.0)
    expect(state.currentCooldownMs).toBe(0)
  })
})
