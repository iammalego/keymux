# keymux

[![npm version](https://img.shields.io/npm/v/keymux)](https://www.npmjs.com/package/keymux)
[![node version](https://img.shields.io/node/v/keymux)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/keymux)](./LICENSE)

Transparent API key pooling for the OpenAI SDK — rotate keys on 429 automatically.

## Why keymux?

Many LLM providers offer free tiers with generous token allowances — but rate limits are enforced **per API key**, not per account. The only way to multiply your effective throughput is to pool keys from multiple accounts and rotate automatically when one hits its limit.

`keymux` does exactly that. Drop it in as a replacement for the `OpenAI` client and it handles rotation transparently — no changes to your existing calls required. Works with any OpenAI-compatible provider: Gemini, Groq, OpenRouter, and more.

### Free-tier providers with OpenAI-compatible endpoints

| Provider | Free tier | Rate limit | Base URL |
|----------|-----------|------------|----------|
| [Gemini](https://aistudio.google.com/apikey) | Permanent | 15 RPM / 1,500 RPD | `https://generativelanguage.googleapis.com/v1beta/openai` |
| [Groq](https://console.groq.com) | Permanent | 30 RPM / 6,000 tokens/min | `https://api.groq.com/openai/v1` |
| [OpenRouter](https://openrouter.ai) | Permanent (28+ free models) | 20 RPM / 200 req/day | `https://openrouter.ai/api/v1` |

> [!NOTE]
> Rate limits apply **per API key**. Each key must come from a separate account to get an independent quota — multiple keys from the same account share the same limit.

## How it works

```
  ┌───────────┐         ┌─────────────────────────────────┐         ┌─────────────┐
  │           │         │            keymux               │         │             │
  │  Your App │────────►│  ┌───────┐ ┌───────┐ ┌───────┐  │────────►│   LLM API   │
  │           │◄────────│  │ Key 1 │ │ Key 2 │ │ Key 3 │  │◄────────│             │
  └───────────┘         │  └───────┘ └───────┘ └───────┘  │         └─────────────┘
                        │                                 │
                        │   auto-rotates on every 429     │
                        └─────────────────────────────────┘
```

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
  keys: [
    process.env.GEMINI_KEY_1!,
    process.env.GEMINI_KEY_2!,
    process.env.GEMINI_KEY_3!,
  ],
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
  keys: [process.env.GROQ_KEY_1!, process.env.GROQ_KEY_2!],
  baseURL: 'https://api.groq.com/openai/v1',
})
```

**OpenRouter**

```typescript
const client = new KeyPool({
  keys: [process.env.OPENROUTER_KEY_1!, process.env.OPENROUTER_KEY_2!],
  baseURL: 'https://openrouter.ai/api/v1',
})
```

When the first key hits its rate limit, `keymux` retries automatically with the next key. If all keys are exhausted, a `KeyPoolExhaustedError` is thrown.

```typescript
import { KeyPool, KeyPoolExhaustedError } from 'keymux'

try {
  const response = await client.chat.completions.create({ ... })
} catch (err) {
  if (err instanceof KeyPoolExhaustedError) {
    console.error(`All ${err.keys.length} keys are rate-limited:`, err.keys)
    // err.keys contains masked keys (safe to log)
    // err.cause is the original RateLimitError from the SDK
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

### OpenRouter

1. Go to [openrouter.ai](https://openrouter.ai) and create an account
2. Navigate to **Keys** → **Create Key**
3. Use model IDs ending in `:free` (e.g. `meta-llama/llama-3.3-70b-instruct:free`)
4. Repeat with different accounts to get more keys

Free tier: 20 RPM and 200 requests/day per key.

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
| `baseURL` | `string` | OpenAI default | Provider base URL. Gemini: `'https://generativelanguage.googleapis.com/v1beta/openai'`, Groq: `'https://api.groq.com/openai/v1'`, OpenRouter: `'https://openrouter.ai/api/v1'` |
| `strategy` | `Strategy` | `'round-robin'` | Key rotation strategy. |
| `maxRetries` | `number` | `keys.length` | Maximum retry attempts before giving up. Defaults to one attempt per key. |
| `onExhausted` | `(maskedKeys: string[]) => void` | — | Called when all keys are exhausted. Receives masked key list (safe to log/alert). |
| `openaiOptions` | `Omit<ClientOptions, 'apiKey' \| 'baseURL' \| 'maxRetries'>` | — | Pass-through options for the underlying OpenAI client (e.g. `fetch`, `timeout`, `defaultHeaders`). |

> [!NOTE]
> `maxRetries` defaults to `keys.length`, meaning each key gets exactly one attempt before `KeyPoolExhaustedError` is thrown. Increase it if you want multiple attempts per key.

### `Strategy`

```typescript
type Strategy = 'round-robin' | 'least-recently-used'
```

- **`round-robin`** (default): Cycles through keys in order. O(1). Deterministic.
- **`least-recently-used`**: Returns the key that was used least recently. O(N). Best for free-tier providers with per-minute limits — maximizes time between reuses of the same key.

### `KeyPoolExhaustedError`

Thrown when all keys in the pool have been rate-limited after exhausting all retry attempts.

| Property | Type | Description |
|----------|------|-------------|
| `name` | `'KeyPoolExhaustedError'` | Always `'KeyPoolExhaustedError'` for reliable `instanceof` checks. |
| `message` | `string` | Human-readable summary, e.g. `'All 3 API keys are rate-limited'`. |
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
import type { KeyPoolConfig, Strategy } from 'keymux'
```

## Project Structure

```
keymux/
├── src/
│   ├── index.ts              # Public exports
│   ├── key-pool.ts           # KeyPool — extends OpenAI, rotation entry point
│   ├── key-pool.test.ts
│   ├── scheduler.ts          # KeyScheduler — round-robin and LRU logic
│   ├── scheduler.test.ts
│   ├── errors.ts             # KeyPoolExhaustedError + maskKey()
│   └── errors.test.ts
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
