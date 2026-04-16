import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { KeyCooldownError, KeyPoolExhaustedError } from './errors'
import { KeyPool } from './key-pool'

function makeMockFetch(responses: Array<{ status: number; body?: object }>) {
  let callCount = 0
  const keysUsed: string[] = []

  const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined
    const auth = headers?.Authorization ?? headers?.authorization
    if (auth) keysUsed.push(auth.replace('Bearer ', ''))

    // biome-ignore lint/style/noNonNullAssertion: responses array is always non-empty (test setup guarantee)
    const response = responses[callCount] ?? responses.at(-1)!
    callCount++

    if (response.status === 429) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Rate limit',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-limit-requests': '3',
            'retry-after': '0',
          },
        },
      )
    }
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  return { mockFetch, keysUsed: () => keysUsed, getCallCount: () => callCount }
}

describe('KeyPool — constructor validation', () => {
  it('throws on empty keys array', () => {
    expect(() => new KeyPool({ keys: [] })).toThrow(/keys/i)
  })
  it('throws on all-empty-string keys', () => {
    expect(() => new KeyPool({ keys: ['', ' ', ''] })).toThrow()
  })
  it('creates instance with a single valid key', () => {
    expect(() => new KeyPool({ keys: ['sk-abc'] })).not.toThrow()
  })
  it('is instanceof OpenAI', () => {
    const pool = new KeyPool({ keys: ['sk-abc'] })
    expect(pool).toBeInstanceOf(OpenAI)
  })
  it('defaults maxRetries to keys.length', () => {
    const pool = new KeyPool({ keys: ['a', 'b', 'c'] })
    expect(pool.maxRetries).toBe(3)
  })
  it('respects explicit maxRetries override', () => {
    const pool = new KeyPool({ keys: ['a', 'b'], openaiOptions: { maxRetries: 0 } })
    expect(pool.maxRetries).toBe(0)
  })
  it('exposes .chat, .embeddings, .models namespaces', () => {
    const pool = new KeyPool({ keys: ['sk-a'] })
    expect(pool.chat).toBeDefined()
    expect(pool.embeddings).toBeDefined()
    expect(pool.models).toBeDefined()
  })
})

describe('KeyPool — 429 rotation', () => {
  it('succeeds when first key is 429 and second succeeds', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }, { status: 200 }])
    const pool = new KeyPool({
      keys: ['sk-bad', 'sk-good'],
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })
    await expect(
      pool.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBeDefined()
  })

  it('throws KeyPoolExhaustedError when all keys return 429', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const pool = new KeyPool({
      keys: ['sk-a', 'sk-b'],
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })
    await expect(
      pool.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(KeyPoolExhaustedError)
  })

  it('KeyPoolExhaustedError has correct message for 2 keys', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const pool = new KeyPool({
      keys: ['sk-a', 'sk-b'],
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })
    const err = await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e)
    expect(err.message).toBe('All 2 API keys are rate-limited')
  })

  it('KeyPoolExhaustedError.keys contains masked keys', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const pool = new KeyPool({
      keys: ['sk-key-aaa', 'sk-key-bbb', 'sk-key-ccc'],
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })
    const err = await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e)
    expect(err.keys).toHaveLength(3)
    expect(err.keys[0]).toContain('...')
  })

  it('KeyPoolExhaustedError.cause is the original RateLimitError', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const pool = new KeyPool({
      keys: ['sk-a'],
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })
    const err = await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e)
    expect(err.cause).toBeInstanceOf(OpenAI.RateLimitError)
  })

  it('calls onExhausted callback when all keys exhausted', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const onExhausted = vi.fn()
    const pool = new KeyPool({
      keys: ['sk-a', 'sk-b'],
      baseURL: 'https://fake.api/v1',
      onExhausted,
      openaiOptions: { fetch: mockFetch },
    })
    await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch(() => {})
    expect(onExhausted).toHaveBeenCalledOnce()
    expect(onExhausted.mock.calls[0][0]).toHaveLength(2)
  })
})

describe('KeyPool.withOptions()', () => {
  it('returns a non-null object with .chat', () => {
    const pool = new KeyPool({ keys: ['sk-a', 'sk-b'] })
    const derived = pool.withOptions({ timeout: 10_000 })
    expect(derived).toBeDefined()
    expect(derived.chat).toBeDefined()
  })
  it('does not throw when called with empty options', () => {
    const pool = new KeyPool({ keys: ['sk-a'] })
    expect(() => pool.withOptions({})).not.toThrow()
  })
})

describe('KeyPool — smart-pool construction', () => {
  it('constructs without error when quotas is a preset string', () => {
    expect(() => new KeyPool({ keys: ['sk-a'], quotas: 'gemini-free' })).not.toThrow()
  })

  it('constructs without error when quotas is a custom QuotaConfig', () => {
    expect(() => new KeyPool({ keys: ['sk-a'], quotas: { rpm: 30 } })).not.toThrow()
  })

  it('throws at construction with descriptive error when preset is invalid', () => {
    expect(
      // @ts-expect-error: intentionally invalid preset for test
      () => new KeyPool({ keys: ['sk-a'], quotas: 'invalid-provider' }),
    ).toThrow(/invalid-provider/)
  })

  it('throws at construction when QuotaConfig is missing rpm', () => {
    expect(
      // @ts-expect-error: intentionally missing rpm for test
      () => new KeyPool({ keys: ['sk-a'], quotas: { tpm: 50_000 } }),
    ).toThrow(/rpm/)
  })

  it('constructs without error when health is false', () => {
    expect(() => new KeyPool({ keys: ['sk-a'], quotas: { rpm: 30 }, health: false })).not.toThrow()
  })

  it('constructs without error when health is an empty object (defaults applied)', () => {
    expect(() => new KeyPool({ keys: ['sk-a'], quotas: { rpm: 30 }, health: {} })).not.toThrow()
  })
})

describe('KeyPool — smart-pool KeyCooldownError', () => {
  it('first request succeeds then second throws KeyCooldownError when rpm=1', async () => {
    const { mockFetch, getCallCount } = makeMockFetch([{ status: 200 }, { status: 200 }])
    const pool = new KeyPool({
      keys: ['sk-a'],
      quotas: { rpm: 1 },
      tokenCounter: () => 999,
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })

    // First request should succeed
    await expect(
      pool.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBeDefined()

    // Second request should throw KeyCooldownError proactively (no HTTP request made)
    const err = await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e)

    expect(err).toBeInstanceOf(KeyCooldownError)
    expect(typeof err.retryAfterMs).toBe('number')
    expect(err.retryAfterMs).toBeGreaterThan(0)

    // Verify mock was only called once (second request was blocked proactively before HTTP)
    expect(getCallCount()).toBe(1)
  })

  it('onExhausted callback NOT called when KeyCooldownError is thrown', async () => {
    const { mockFetch } = makeMockFetch([{ status: 200 }])
    const onExhausted = vi.fn()
    const pool = new KeyPool({
      keys: ['sk-a'],
      quotas: { rpm: 1 },
      tokenCounter: () => 999,
      onExhausted,
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })

    // First request succeeds
    await pool.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'hi' }],
    })

    // Second request throws KeyCooldownError — onExhausted must NOT be called
    await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch(() => {})

    expect(onExhausted).not.toHaveBeenCalled()
  })
})

describe('KeyPool — smart-pool success feedback (SCENARIO-7.3)', () => {
  it('successful response updates budget with actual token usage', async () => {
    // Mock returns usage: { total_tokens: 8 }
    const { mockFetch } = makeMockFetch([{ status: 200 }, { status: 200 }])
    const pool = new KeyPool({
      keys: ['sk-a'],
      quotas: { rpm: 10, tpm: 99 },
      // Custom counter estimates 50 tokens — but real usage is 8 (from mock)
      tokenCounter: () => 50,
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })

    // First request: estimates 50 tokens, actual response has total_tokens: 8
    await pool.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'hi' }],
    })

    // If recordOutcome corrected the budget (50 → 8):
    //   8 (corrected) + 50 (new estimate) = 58 > 99? NO → passes
    // If NOT corrected (bug):
    //   50 (stale estimate) + 50 (new) = 100 > 99? YES → KeyCooldownError

    // Second request should succeed ONLY if budget was corrected
    await expect(
      pool.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBeDefined()
  })
})

describe('KeyPool — backward compatibility (no quotas)', () => {
  it('without quotas: all 429s → KeyPoolExhaustedError (NOT KeyCooldownError)', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const pool = new KeyPool({
      keys: ['sk-a', 'sk-b'],
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })
    const err = await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e)

    expect(err).toBeInstanceOf(KeyPoolExhaustedError)
    expect(err).not.toBeInstanceOf(KeyCooldownError)
  })

  it('without quotas: onExhausted IS called when all keys exhausted', async () => {
    const { mockFetch } = makeMockFetch([{ status: 429 }])
    const onExhausted = vi.fn()
    const pool = new KeyPool({
      keys: ['sk-a', 'sk-b'],
      baseURL: 'https://fake.api/v1',
      onExhausted,
      openaiOptions: { fetch: mockFetch },
    })
    await pool.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch(() => {})

    expect(onExhausted).toHaveBeenCalledOnce()
  })
})

describe('KeyPool — withOptions preserves smart-pool config', () => {
  it('derived client still has smart-pool behavior after withOptions', async () => {
    const { mockFetch } = makeMockFetch([{ status: 200 }, { status: 200 }])
    const pool = new KeyPool({
      keys: ['sk-a'],
      quotas: { rpm: 1 },
      tokenCounter: () => 999,
      baseURL: 'https://fake.api/v1',
      openaiOptions: { fetch: mockFetch },
    })

    const derived = pool.withOptions({ timeout: 5_000 })

    // First request succeeds
    await expect(
      derived.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBeDefined()

    // Second request should throw KeyCooldownError (smart-pool preserved)
    const err = await derived.chat.completions
      .create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e)

    expect(err).toBeInstanceOf(KeyCooldownError)
  })
})
