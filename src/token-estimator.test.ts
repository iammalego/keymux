import { describe, expect, it, vi } from 'vitest'
import { createTokenEstimator } from './token-estimator'

describe('createTokenEstimator', () => {
  describe('default estimator', () => {
    const estimate = createTokenEstimator()

    it('SCENARIO-1.1: single message 11 chars → 3 (ceil(11/4))', () => {
      // "hello world" = 11 chars, ceil(11/4) = ceil(2.75) = 3
      const body = { messages: [{ role: 'user', content: 'hello world' }] }
      expect(estimate(body)).toBe(3)
    })

    it('SCENARIO-1.2: two messages 16 chars total → 4', () => {
      // "hello" (5) + "world!!!!!!" (11) = 16, ceil(16/4) = 4
      const body = {
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'world!!!!!!' },
        ],
      }
      expect(estimate(body)).toBe(4)
    })

    it('SCENARIO-1.3: no messages field → 0', () => {
      expect(estimate({ model: 'gpt-4' })).toBe(0)
    })

    it('SCENARIO-1.4: messages: [] → 0', () => {
      expect(estimate({ messages: [] })).toBe(0)
    })

    it('SCENARIO-1.5: message without content → 0', () => {
      const body = { messages: [{ role: 'user' }] }
      expect(estimate(body)).toBe(0)
    })

    it('SCENARIO-1.6: content: null → 0', () => {
      const body = { messages: [{ role: 'user', content: null }] }
      expect(estimate(body)).toBe(0)
    })

    it('Extra: content: 123 (number) → 0', () => {
      const body = { messages: [{ role: 'user', content: 123 }] }
      expect(estimate(body)).toBe(0)
    })

    it('Extra: messages is string → 0', () => {
      const body = { messages: 'not-an-array' }
      expect(estimate(body)).toBe(0)
    })
  })

  describe('custom counter', () => {
    it('SCENARIO-1.7: custom counter returns 42 → 42', () => {
      const custom = vi.fn().mockReturnValue(42)
      const estimate = createTokenEstimator(custom)
      const body = { messages: [{ role: 'user', content: 'hello' }] }
      expect(estimate(body)).toBe(42)
    })

    it('SCENARIO-1.8: custom counter receives full body reference', () => {
      const body = { messages: [{ role: 'user', content: 'hello' }], model: 'gpt-4' }
      let captured: unknown
      const custom = (b: unknown) => {
        captured = b
        return 1
      }
      const estimate = createTokenEstimator(custom)
      estimate(body)
      expect(captured).toBe(body)
    })

    it('SCENARIO-1.9: custom counter throws → error propagates', () => {
      const boom = new Error('counter exploded')
      const custom = () => {
        throw boom
      }
      const estimate = createTokenEstimator(custom)
      expect(() => estimate({ messages: [] })).toThrow('counter exploded')
    })
  })
})
