import { describe, expect, it } from 'vitest'
import { KeyScheduler } from './scheduler'

describe('KeyScheduler — validation', () => {
  it('throws on empty keys array', () => {
    expect(() => new KeyScheduler([], 'round-robin')).toThrow()
  })
  it('throws on all-empty-string keys', () => {
    expect(() => new KeyScheduler(['', '', ''], 'round-robin')).toThrow()
  })
  it('reports correct size', () => {
    const s = new KeyScheduler(['a', 'b', 'c'], 'round-robin')
    expect(s.size).toBe(3)
  })
  it('defaults to round-robin when strategy omitted', () => {
    const s = new KeyScheduler(['a', 'b', 'c'])
    // verify order: a, b, c, a
    expect(s.nextKey()).toBe('a')
    expect(s.nextKey()).toBe('b')
    expect(s.nextKey()).toBe('c')
    expect(s.nextKey()).toBe('a')
  })
})

describe('KeyScheduler — round-robin', () => {
  it('returns keys in order', () => {
    const s = new KeyScheduler(['A', 'B', 'C'], 'round-robin')
    expect(s.nextKey()).toBe('A')
    expect(s.nextKey()).toBe('B')
    expect(s.nextKey()).toBe('C')
  })
  it('wraps around after last key', () => {
    const s = new KeyScheduler(['A', 'B', 'C'], 'round-robin')
    const calls = Array.from({ length: 6 }, () => s.nextKey())
    expect(calls).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
  })
  it('single key always returns same key', () => {
    const s = new KeyScheduler(['only'], 'round-robin')
    const calls = Array.from({ length: 5 }, () => s.nextKey())
    expect(calls).toEqual(['only', 'only', 'only', 'only', 'only'])
  })
  it('is deterministic across two instances', () => {
    const s1 = new KeyScheduler(['A', 'B', 'C'], 'round-robin')
    const s2 = new KeyScheduler(['A', 'B', 'C'], 'round-robin')
    const seq1 = Array.from({ length: 6 }, () => s1.nextKey())
    const seq2 = Array.from({ length: 6 }, () => s2.nextKey())
    expect(seq1).toEqual(seq2)
  })
})

describe('KeyScheduler — least-recently-used', () => {
  it('returns keys in index order on first pass (tie-breaking)', () => {
    const s = new KeyScheduler(['A', 'B', 'C'], 'least-recently-used')
    expect(s.nextKey()).toBe('A')
    expect(s.nextKey()).toBe('B')
    expect(s.nextKey()).toBe('C')
  })
  it('returns first key again on 4th call (stalest)', () => {
    const s = new KeyScheduler(['A', 'B', 'C'], 'least-recently-used')
    s.nextKey() // A
    s.nextKey() // B
    s.nextKey() // C
    expect(s.nextKey()).toBe('A')
  })
  it('returns different key on second call after first is used', () => {
    const s = new KeyScheduler(['A', 'B'], 'least-recently-used')
    const first = s.nextKey()
    const second = s.nextKey()
    expect(first).not.toBe(second)
  })
  it('tie-breaks by lower index on fresh instance', () => {
    const s = new KeyScheduler(['X', 'Y'], 'least-recently-used')
    expect(s.nextKey()).toBe('X')
  })
})
