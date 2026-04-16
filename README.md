# keymux

[![npm version](https://img.shields.io/npm/v/keymux)](https://www.npmjs.com/package/keymux)
[![node version](https://img.shields.io/node/v/keymux)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/keymux)](./LICENSE)

Transparent API key pooling for the OpenAI SDK — rotate keys on 429 automatically.

## Why keymux?

Google's Gemini models are available for free via the OpenAI-compatible endpoint. The catch: each Google account is limited to a small number of requests per minute on the free tier. With `keymux`, you can pool multiple API keys from different Google accounts and let the library automatically rotate to the next key whenever a 429 (rate limit) response is received — no changes to your existing OpenAI SDK calls required. `KeyPool` extends `OpenAI` directly, so it is a true drop-in replacement.

## How it works

```
  ┌───────────┐         ┌─────────────────────────────────┐         ┌─────────────┐
  │           │         │            keymux               │         │             │
  │  Your App │────────►│  ┌───────┐ ┌───────┐ ┌───────┐  │────────►│  Gemini API │
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

```typescript
import { KeyPool } from 'keymux'

const client = new KeyPool({
  keys: [
    process.env.GEMINI_KEY_1!,
    process.env.GEMINI_KEY_2!,
    process.env.GEMINI_KEY_3!,
  ],
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
})

// Use exactly like the OpenAI SDK — key rotation happens transparently
const response = await client.chat.completions.create({
  model: 'gemini-2.0-flash',
  messages: [{ role: 'user', content: 'Hello!' }],
})

console.log(response.choices[0]?.message.content)
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

## Gemini Free Tier Guide

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with a Google account
3. Click **Get API key** → **Create API key**
4. Copy the key (format: `AIzaSy...`)
5. Repeat steps 1–4 with **different Google accounts** to get more keys

Each Google Cloud project gets its own free tier quota. On the free tier you get up to 15 RPM (requests per minute) and 1,500 RPD (requests per day) per project with Gemini 2.0 Flash.

> [!WARNING]
> **Keys must be from different Google accounts.**
>
> Multiple API keys created under the **same Google account or the same Google Cloud project** share the same rate limit quota. Creating 10 keys from the same account does NOT give you 10× the rate limit.
>
> To multiply your effective rate limit, each key must come from a completely separate Google account (and therefore a separate Google Cloud project).

> [!TIP]
> Use `strategy: 'least-recently-used'` for Gemini. It always picks the key unused for the longest time, maximizing the window between reuses and reducing the chance of hitting the per-minute limit.
>
> ```typescript
> const client = new KeyPool({
>   keys: [...],
>   baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
>   strategy: 'least-recently-used',
> })
> ```

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
| `baseURL` | `string` | OpenAI default | Provider base URL. For Gemini: `'https://generativelanguage.googleapis.com/v1beta/openai'` |
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
- **`least-recently-used`**: Returns the key that was used least recently. O(N). Best for Gemini free tier — maximizes time between reuses of the same key.

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
