import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetTracker } from './budget-tracker'
import type { HealthMonitor } from './health-monitor'
import { KeyScheduler } from './scheduler'
import { SmartScheduler } from './smart-scheduler'
import type { BudgetState, QuotaConfig } from './types'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockBudget(
  overrides: Partial<Record<keyof BudgetTracker, unknown>> = {},
): BudgetTracker {
  return {
    canAccommodate: vi.fn().mockReturnValue(true),
    recordRequest: vi.fn(),
    recordActual: vi.fn(),
    applyCooldown: vi.fn(),
    getBudgetState: vi
      .fn()
      .mockReturnValue({ rpmUsed: 0, tpmUsed: 0, rpdUsed: 0, tpdUsed: 0 } satisfies BudgetState),
    getMinCooldownRemaining: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as BudgetTracker
}

function makeMockHealth(
  overrides: Partial<Record<keyof HealthMonitor, unknown>> = {},
): HealthMonitor {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    getHealthScore: vi.fn().mockReturnValue(1.0),
    getHealthState: vi.fn(),
    ...overrides,
  } as unknown as HealthMonitor
}

const BASE_QUOTAS: QuotaConfig = { rpm: 10, tpm: 1000 }

function makeScheduler(
  keys: string[],
  quotas: QuotaConfig,
  budget: BudgetTracker,
  health: HealthMonitor,
): SmartScheduler {
  const fallback = new KeyScheduler(keys)
  return new SmartScheduler(keys, quotas, {
    budgetTracker: budget,
    healthMonitor: health,
    estimator: (_body) => 100,
    fallbackScheduler: fallback,
  })
}

// ---------------------------------------------------------------------------
// SCENARIO-4.1 – 4.9 + extras: selectKey
// ---------------------------------------------------------------------------

describe('SmartScheduler — selectKey', () => {
  it('SCENARIO-4.1: 3 keys, only key-C can accommodate → returns key-C', () => {
    const budget = makeMockBudget({
      canAccommodate: vi.fn().mockImplementation((key: string) => key === 'key-C'),
    })
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A', 'key-B', 'key-C'], BASE_QUOTAS, budget, health)

    expect(scheduler.selectKey(100)).toBe('key-C')
  })

  it('SCENARIO-4.2: tie-break by lowest TPM utilization → picks key-B (200/1000 < 800/1000)', () => {
    const budget = makeMockBudget({
      canAccommodate: vi.fn().mockReturnValue(true),
      getBudgetState: vi
        .fn()
        .mockImplementation(
          (key: string): BudgetState =>
            key === 'key-A'
              ? { rpmUsed: 0, tpmUsed: 800, rpdUsed: 0, tpdUsed: 0 }
              : { rpmUsed: 0, tpmUsed: 200, rpdUsed: 0, tpdUsed: 0 },
        ),
    })
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A', 'key-B'], { rpm: 10, tpm: 1000 }, budget, health)

    expect(scheduler.selectKey(100)).toBe('key-B')
  })

  it('SCENARIO-4.3: all keys pass health, none pass budget → null', () => {
    const budget = makeMockBudget({
      canAccommodate: vi.fn().mockReturnValue(false),
    })
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A', 'key-B'], BASE_QUOTAS, budget, health)

    expect(scheduler.selectKey(100)).toBeNull()
  })

  it('SCENARIO-4.4: all keys unhealthy → null (budget is never checked)', () => {
    const budget = makeMockBudget()
    const health = makeMockHealth({
      isAvailable: vi.fn().mockReturnValue(false),
    })
    const scheduler = makeScheduler(['key-A', 'key-B'], BASE_QUOTAS, budget, health)

    expect(scheduler.selectKey(100)).toBeNull()
  })

  it('SCENARIO-4.5: single key, healthy, has budget → returns it', () => {
    const budget = makeMockBudget()
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A'], BASE_QUOTAS, budget, health)

    expect(scheduler.selectKey(100)).toBe('key-A')
  })

  it('SCENARIO-4.6: single key available → returns it', () => {
    const budget = makeMockBudget()
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A'], BASE_QUOTAS, budget, health)

    expect(scheduler.selectKey(50)).toBe('key-A')
  })

  it('SCENARIO-4.7: single key exhausted (budget false) → null', () => {
    const budget = makeMockBudget({
      canAccommodate: vi.fn().mockReturnValue(false),
    })
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A'], BASE_QUOTAS, budget, health)

    expect(scheduler.selectKey(100)).toBeNull()
  })

  it('Extra: tie-break by RPM when no TPM configured → picks lower rpmUsed', () => {
    const budget = makeMockBudget({
      canAccommodate: vi.fn().mockReturnValue(true),
      getBudgetState: vi
        .fn()
        .mockImplementation(
          (key: string): BudgetState =>
            key === 'key-A'
              ? { rpmUsed: 8, tpmUsed: 0, rpdUsed: 0, tpdUsed: 0 }
              : { rpmUsed: 2, tpmUsed: 0, rpdUsed: 0, tpdUsed: 0 },
        ),
    })
    const health = makeMockHealth()
    // No tpm in quotas
    const scheduler = makeScheduler(['key-A', 'key-B'], { rpm: 10 }, budget, health)

    expect(scheduler.selectKey(100)).toBe('key-B')
  })

  it('Extra: tie-break by pool order when utilization is identical → first in pool wins', () => {
    const budget = makeMockBudget({
      canAccommodate: vi.fn().mockReturnValue(true),
      getBudgetState: vi.fn().mockReturnValue({ rpmUsed: 5, tpmUsed: 500, rpdUsed: 0, tpdUsed: 0 }),
    })
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A', 'key-B'], { rpm: 10, tpm: 1000 }, budget, health)

    expect(scheduler.selectKey(100)).toBe('key-A')
  })
})

// ---------------------------------------------------------------------------
// SCENARIO-4.8 & 4.9: recordOutcome
// ---------------------------------------------------------------------------

describe('SmartScheduler — recordOutcome', () => {
  it('SCENARIO-4.8: success → recordActual + recordSuccess called', () => {
    const budget = makeMockBudget()
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A'], BASE_QUOTAS, budget, health)

    scheduler.recordOutcome('key-A', 80, true)

    expect(budget.recordActual).toHaveBeenCalledWith('key-A', 80)
    expect(health.recordSuccess).toHaveBeenCalledWith('key-A')
    expect(health.recordFailure).not.toHaveBeenCalled()
  })

  it('SCENARIO-4.9: failure → recordActual + recordFailure called, recordSuccess NOT called', () => {
    const budget = makeMockBudget()
    const health = makeMockHealth()
    const scheduler = makeScheduler(['key-A'], BASE_QUOTAS, budget, health)

    scheduler.recordOutcome('key-A', 0, false)

    expect(budget.recordActual).toHaveBeenCalledWith('key-A', 0)
    expect(health.recordFailure).toHaveBeenCalledWith('key-A')
    expect(health.recordSuccess).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Extra: delegation tests
// ---------------------------------------------------------------------------

describe('SmartScheduler — delegation', () => {
  let budget: BudgetTracker
  let health: HealthMonitor
  let scheduler: SmartScheduler

  beforeEach(() => {
    budget = makeMockBudget()
    health = makeMockHealth()
    scheduler = makeScheduler(['key-A'], BASE_QUOTAS, budget, health)
  })

  it('Extra: applyCooldown delegates to budgetTracker', () => {
    scheduler.applyCooldown('key-A', 'rpm', 60_000)
    expect(budget.applyCooldown).toHaveBeenCalledWith('key-A', 'rpm', 60_000)
  })

  it('Extra: estimateTokens delegates to estimator', () => {
    const result = scheduler.estimateTokens({ prompt: 'hello' })
    expect(result).toBe(100)
  })

  it('Extra: recordRequest delegates to budgetTracker', () => {
    scheduler.recordRequest('key-A', 50)
    expect(budget.recordRequest).toHaveBeenCalledWith('key-A', 50)
  })

  it('Extra: getMinCooldownRemaining delegates to budgetTracker', () => {
    ;(budget.getMinCooldownRemaining as ReturnType<typeof vi.fn>).mockReturnValue(5000)
    const result = scheduler.getMinCooldownRemaining()
    expect(result).toBe(5000)
    expect(budget.getMinCooldownRemaining).toHaveBeenCalled()
  })
})
