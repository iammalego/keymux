# keymux

[![npm version](https://img.shields.io/npm/v/keymux)](https://www.npmjs.com/package/keymux)
[![node version](https://img.shields.io/node/v/keymux)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/keymux)](./LICENSE)

Transparent API key pooling for the OpenAI SDK — smart scheduling with proactive rate limit avoidance.

## Why keymux?

Many LLM providers offer free tiers with generous token allowances — but rate limits are enforced **per API key**, not per account. The only way to multiply your effective throughput is to pool keys from multiple accounts and rotate automatically when one hits its limit.

`keymux` does exactly that. Drop it in as a replacement for the `OpenAI` client and it handles rotation transparently — no changes to your existing calls required. With **smart scheduling**, it tracks per-key budgets and avoids 429s before they happen. Works with any OpenAI-compatible provider: Gemini, Groq, OpenRouter, and more.

### How it works

```
  ┌───────────┐         ┌─────────────────────────────────┐         ┌─────────────┐
  │           │         │            keymux               │         │             │
  │  Your App │────────►│  ┌───────┐ ┌───────┐ ┌───────┐  │────────►│   LLM API   │
  │           │◄────────│  │ Key 1 │ │ Key 2 │ │ Key 3 │  │◄────────│             │
  └───────────┘         │  └───────┘ └───────┘ └───────┘  │         └─────────────┘
                        │                                 │
                        │  Smart: picks key with budget   │
                        │  Basic: auto-rotates on 429     │
                        └─────────────────────────────────┘
```

### Free-tier providers with OpenAI-compatible endpoints

| Provider | Free tier | Rate limit | Base URL |
|----------|-----------|------------|----------|
| [Gemini](https://aistudio.google.com/apikey) | Permanent | 15 RPM / 1,500 RPD | `https://generativelanguage.googleapis.com/v1beta/openai` |
| [Groq](https://console.groq.com) | Permanent | 30 RPM / 6,000 tokens/min | `https://api.groq.com/openai/v1` |
| [Cerebras](https://cloud.cerebras.ai) | Permanent | 30 RPM / 1M tokens/day | `https://api.cerebras.ai/v1` |
| [OpenRouter](https://openrouter.ai) | Permanent (29+ free models) | 20 RPM / 200 req/day | `https://openrouter.ai/api/v1` |
| [NVIDIA NIM](https://build.nvidia.com) | Permanent | ~40 RPM / 100+ models | `https://integrate.api.nvidia.com/v1` |

> [!NOTE]
> Rate limits apply **per API key**. Each key must come from a separate account to get an independent quota — multiple keys from the same account share the same limit.

## Installation

```bash
npm i keymux
```

> [!IMPORTANT]
> `keymux` requires **`openai` >= 6.0.0**. The async `apiKey` function support used internally was introduced in v6.

## Getting Started

**Gemini** (Google AI Studio)

```typescript
import { KeyPool } from 'keymux'

const client = new KeyPool({
  keys: process.env.GEMINI_KEYS!, // "key1,key2,key3"
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  strategy: 'least-recently-used',
})

const response = await client.chat.completions.create({
  model: 'gemini-2.0-flash',
  messages: [{ role: 'user', content: 'Hello!' }],
})

console.log(response.choices[0]?.message.content)
```

**Groq**

```typescript
const client = new KeyPool({
  keys: process.env.GROQ_KEYS!,
  baseURL: 'https://api.groq.com/openai/v1',
})
```

**Cerebras**

```typescript
const client = new KeyPool({
  keys: process.env.CEREBRAS_KEYS!,
  baseURL: 'https://api.cerebras.ai/v1',
})
```

**OpenRouter**

```typescript
const client = new KeyPool({
  keys: process.env.OPENROUTER_KEYS!,
  baseURL: 'https://openrouter.ai/api/v1',
})
```

**NVIDIA NIM**

```typescript
const client = new KeyPool({
  keys: process.env.NVIDIA_KEYS!,
  baseURL: 'https://integrate.api.nvidia.com/v1',
})
```

> [!TIP]
> `keys` accepts both a string array and a comma-separated string, so you can use a single env var per provider instead of one per key.

By default, `keymux` retries automatically with the next key when one hits a 429. If all keys are exhausted, a `KeyPoolExhaustedError` is thrown.

## Smart Scheduling

Add `quotas` to enable proactive rate limit avoidance. Instead of waiting for 429 errors, `keymux` tracks per-key budgets and picks the key with available capacity **before** sending the request.

```typescript
import { KeyPool, KeyCooldownError } from 'keymux'

const client = new KeyPool({
  keys: [
    process.env.GEMINI_KEY_1!,
    process.env.GEMINI_KEY_2!,
    process.env.GEMINI_KEY_3!,
  ],
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  strategy: 'least-recently-used',
  quotas: 'gemini-free', // ← enables smart scheduling
})

try {
  const response = await client.chat.completions.create({
    model: 'gemini-2.0-flash',
    messages: [{ role: 'user', content: 'Hello!' }],
  })
} catch (err) {
  if (err instanceof KeyCooldownError) {
    // All keys are temporarily on cooldown — you know exactly when to retry
    console.log(`Retry in ${err.retryAfterMs}ms`)
    await new Promise((r) => setTimeout(r, err.retryAfterMs))
  }
}
```

### What smart scheduling does

| Feature | Without `quotas` | With `quotas` |
|---------|-----------------|---------------|
| Key selection | Blind rotation (round-robin/LRU) | Picks key with available budget |
| Rate limit detection | After 429 (wasted request) | Before sending (proactive) |
| Daily limit handling | Keeps retrying dead keys | Marks key until midnight reset |
| Failing keys | Keeps using them | Circuit breaker excludes them |
| Error on exhaustion | `KeyPoolExhaustedError` | `KeyCooldownError` with `retryAfterMs` |
| Token tracking | None | Estimates before, corrects after with real usage |

### Provider presets

Use a preset string for known providers:

| Preset | RPM | TPM | RPD |
|--------|-----|-----|-----|
| `'gemini-free'` | 15 | — | 1,500 |
| `'openai-tier-1'` | 60 | 60,000 | — |
| `'openai-tier-2'` | 3,500 | 90,000 | — |
| `'groq-free'` | 30 | — | 14,400 |
| `'openrouter-free'` | 20 | — | 200 |

Or pass a custom `QuotaConfig`:

```typescript
const client = new KeyPool({
  keys: [...],
  quotas: { rpm: 100, tpm: 50_000, rpd: 10_000 },
})
```

### Health monitoring

Keys that return repeated errors (5xx, network failures) are automatically excluded via a circuit breaker:

- **3 failures** within 60s → key excluded for 60s
- After cooldown → one probe request allowed
- Probe succeeds → key returns to rotation
- Probe fails → excluded again with doubled cooldown (up to 5 min)

Disable with `health: false`. Configure thresholds with `health: { threshold: 5, cooldownMs: 30_000 }`.

### Error handling

```typescript
import { KeyPool, KeyCooldownError, KeyPoolExhaustedError } from 'keymux'

try {
  const response = await client.chat.completions.create({ ... })
} catch (err) {
  if (err instanceof KeyCooldownError) {
    // Smart scheduling: all keys temporarily on cooldown
    // No HTTP request was made — blocked proactively
    console.log(`Retry in ${err.retryAfterMs}ms`)
  }
  if (err instanceof KeyPoolExhaustedError) {
    // Basic rotation: all keys hit 429 after retrying
    console.error(`All ${err.keys.length} keys exhausted:`, err.keys)
  }
}
```

## Provider Guides

> [!WARNING]
> **Keys must come from different accounts.**
>
> Multiple keys created under the **same account** share the same rate limit quota. Creating 10 keys from the same account does NOT give you 10× the rate limit. Each key must come from a completely separate account to get an independent quota.

> [!TIP]
> Use `strategy: 'least-recently-used'` for free-tier providers with per-minute limits. It always picks the key unused for the longest time, maximizing the window between reuses.

### Gemini

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with a Google account
3. Click **Get API key** → **Create API key**
4. Copy the key (format: `AIzaSy...`)
5. Repeat with **different Google accounts** to get more keys

Free tier: 15 RPM and 1,500 RPD per key with Gemini 2.0 Flash.

### Groq

1. Go to [console.groq.com](https://console.groq.com) and create an account
2. Navigate to **API Keys** → **Create API Key**
3. Repeat with different accounts to get more keys

Free tier: 30 RPM and 6,000 tokens/min per key.

### Cerebras

1. Go to [cloud.cerebras.ai](https://cloud.cerebras.ai) and create an account
2. Navigate to **API Keys** → **Create API Key**
3. Repeat with different accounts to get more keys

Free tier: 30 RPM and 1M tokens/day per key. No credit card required.

### OpenRouter

1. Go to [openrouter.ai](https://openrouter.ai) and create an account
2. Navigate to **Keys** → **Create Key**
3. Use model IDs ending in `:free` (e.g. `meta-llama/llama-3.3-70b-instruct:free`)
4. Repeat with different accounts to get more keys

Free tier: 20 RPM and 200 requests/day per key.

### NVIDIA NIM

1. Join the [NVIDIA Developer Program](https://build.nvidia.com) (free)
2. Navigate to any model page and click **Get API Key**
3. Copy the key (format: `nvapi-...`)
4. Repeat with different accounts to get more keys

Free tier: ~40 RPM, 100+ models available.

## API Reference

### `KeyPool`

`KeyPool` extends `OpenAI`. All methods, properties, and namespaces (`.chat`, `.embeddings`, `.models`, `.images`, `.audio`, etc.) are inherited.

```typescript
const client = new KeyPool(config: KeyPoolConfig)
```

### `KeyPoolConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `keys` | `string[]` | required | API keys for rotation. Minimum 1; rotation is effective with 2+. |
| `baseURL` | `string` | OpenAI default | Provider base URL. |
| `strategy` | `Strategy` | `'round-robin'` | Key rotation strategy. |
| `maxRetries` | `number` | `keys.length` | Maximum retry attempts before giving up. |
| `onExhausted` | `(maskedKeys: string[]) => void` | — | Called when all keys are exhausted via 429. Not called for `KeyCooldownError`. |
| `quotas` | `ProviderPreset \| QuotaConfig` | — | Enables smart scheduling. Pass a preset string or custom config. |
| `health` | `HealthConfig \| false` | `{}` | Circuit breaker config. `false` disables health monitoring. |
| `tokenCounter` | `(body: unknown) => number` | chars/4 heuristic | Custom token estimation function for budget tracking. |
| `openaiOptions` | `Omit<ClientOptions, ...>` | — | Pass-through options for the underlying OpenAI client. |

> [!NOTE]
> Without `quotas`, keymux behaves exactly like v0.1.x — reactive rotation only. Smart scheduling is fully opt-in.
> When `quotas` is set, `strategy` is ignored — smart scheduling uses its own key selection (lowest budget utilization).

### `Strategy`

```typescript
type Strategy = 'round-robin' | 'least-recently-used'
```

- **`round-robin`** (default): Cycles through keys in order. O(1). Deterministic.
- **`least-recently-used`**: Returns the key that was used least recently. O(N). Best for free-tier providers with per-minute limits — maximizes time between reuses of the same key.

### `QuotaConfig`

Custom rate limit configuration. `rpm` is required — other dimensions are optional (untracked if omitted).

```typescript
interface QuotaConfig {
  rpm: number              // Requests per minute (required)
  tpm?: number             // Tokens per minute
  rpd?: number             // Requests per day
  tpd?: number             // Tokens per day
  dailyResetHour?: number  // UTC hour for daily reset (default: 7 = midnight PT)
}
```

### `HealthConfig`

Circuit breaker configuration. All fields optional with sensible defaults.

```typescript
interface HealthConfig {
  threshold?: number       // Failures to trip circuit (default: 3)
  windowSize?: number      // Failure counting window in ms (default: 60,000)
  cooldownMs?: number      // Base cooldown when tripped (default: 60,000)
  maxCooldownMs?: number   // Max cooldown after backoff (default: 300,000)
}
```

### `KeyCooldownError`

Thrown **proactively** when smart scheduling determines no key has available budget. No HTTP request is made.

| Property | Type | Description |
|----------|------|-------------|
| `name` | `'KeyCooldownError'` | For reliable `instanceof` checks. |
| `message` | `string` | e.g. `'All API keys are on cooldown. Retry after 23s'` |
| `retryAfterMs` | `number` | Shortest cooldown remaining across all keys, in milliseconds. |

### `KeyPoolExhaustedError`

Thrown **reactively** when all keys have been rate-limited after exhausting all retry attempts (429 errors).

| Property | Type | Description |
|----------|------|-------------|
| `name` | `'KeyPoolExhaustedError'` | For reliable `instanceof` checks. |
| `message` | `string` | e.g. `'All 3 API keys are rate-limited'` |
| `keys` | `string[]` | All keys that were tried, **masked** (e.g. `'AIza...cdef'`). Safe to log. |
| `cause` | `RateLimitError` | The original `RateLimitError` from the OpenAI SDK. |

### `maskKey(key: string): string`

Masks an API key for safe logging: shows the first 4 and last 4 characters separated by `...`. Keys shorter than 8 characters are returned as `'***'`.

```typescript
import { maskKey } from 'keymux'

maskKey('AIzaSyB1234567890abcdef') // → 'AIza...cdef'
maskKey('sk-proj-abc123xyz')       // → 'sk-p...3xyz'
maskKey('short')                   // → '***'
```

> [!NOTE]
> `maskKey` is exported so you can use it in your own logging — for example when you store keys in a database and want to display them safely in a UI.

## TypeScript

Full TypeScript types ship with the package. No `@types/` package needed.

```typescript
import { KeyPool, KeyCooldownError, KeyPoolExhaustedError, PRESETS, maskKey } from 'keymux'
import type { KeyPoolConfig, Strategy, QuotaConfig, HealthConfig, ProviderPreset } from 'keymux'
```

## Project Structure

```
keymux/
├── src/
│   ├── index.ts              # Public exports
│   ├── key-pool.ts           # KeyPool — extends OpenAI, wires everything together
│   ├── smart-scheduler.ts    # 3-stage key selection (health → budget → tie-break)
│   ├── budget-tracker.ts     # Per-key sliding window RPM/TPM/RPD tracking
│   ├── health-monitor.ts     # Per-key circuit breaker with exponential backoff
│   ├── token-estimator.ts    # Pre-request token estimation (heuristic or custom)
│   ├── presets.ts            # Provider preset definitions and resolution
│   ├── request-context.ts    # AsyncLocalStorage for request-scoped state
│   ├── scheduler.ts          # KeyScheduler — round-robin and LRU logic
│   ├── errors.ts             # KeyPoolExhaustedError + KeyCooldownError + maskKey
│   ├── types.ts              # Shared type definitions
│   └── *.test.ts             # Co-located test files (136 tests)
├── dist/                     # Build output (ESM + CJS + .d.ts)
├── tsup.config.ts            # Build config
├── vitest.config.ts          # Test config
└── package.json
```

## Contributing

Bug reports and feature requests are welcome — please use the [issue templates](https://github.com/iammalego/keymux/issues/new/choose).

For code contributions:

```bash
git clone https://github.com/iammalego/keymux.git
cd keymux
npm install

npm test           # run tests
npx tsc --noEmit   # type check
npm run build      # build dist/
```

> [!NOTE]
> This project follows strict TDD — tests are written before implementation.
> All PRs must include tests for new behavior.

## License

MIT
