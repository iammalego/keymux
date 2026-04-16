import { describe, expect, it } from 'vitest'
import { RequestContext } from './request-context'

describe('RequestContext', () => {
  it('getStore() outside run → undefined', () => {
    expect(RequestContext.getStore()).toBeUndefined()
  })

  it('within run → getStore() returns the store', () => {
    const store = { key: 'test-key', estimatedTokens: 10 }
    RequestContext.run(store, () => {
      expect(RequestContext.getStore()).toBe(store)
    })
  })

  it('after run → undefined', () => {
    const store = { key: 'test-key' }
    RequestContext.run(store, () => {
      // no-op
    })
    expect(RequestContext.getStore()).toBeUndefined()
  })

  it('concurrent isolation (two parallel runs each reads own store)', async () => {
    const storeA = { key: 'key-A' }
    const storeB = { key: 'key-B' }

    const results: string[] = []

    await Promise.all([
      RequestContext.run(storeA, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        const s = RequestContext.getStore()
        results.push(s?.key ?? 'undefined')
      }),
      RequestContext.run(storeB, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        const s = RequestContext.getStore()
        results.push(s?.key ?? 'undefined')
      }),
    ])

    // Each run should see its own store, not the other's
    expect(results).toContain('key-A')
    expect(results).toContain('key-B')
    expect(results).toHaveLength(2)
  })

  it('nested run restores outer store after inner run completes', () => {
    const outer = { key: 'outer-key' }
    const inner = { key: 'inner-key' }

    RequestContext.run(outer, () => {
      expect(RequestContext.getStore()).toBe(outer)

      RequestContext.run(inner, () => {
        expect(RequestContext.getStore()).toBe(inner)
      })

      // After inner run completes, outer store is restored
      expect(RequestContext.getStore()).toBe(outer)
    })
  })
})
