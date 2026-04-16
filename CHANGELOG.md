# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Smart scheduling with proactive rate limit avoidance — enable with `quotas` config option
- Per-key budget tracking with sliding windows for RPM, TPM, RPD, and TPD quota dimensions
- Provider presets for one-liner config: `'gemini-free'`, `'openai-tier-1'`, `'openai-tier-2'`, `'groq-free'`, `'openrouter-free'`
- `KeyCooldownError` thrown proactively when all keys are on cooldown — includes `retryAfterMs` so callers know exactly when to retry
- Per-key circuit breaker (health monitoring) with exponential backoff — automatically excludes failing keys
- Post-response budget correction using actual `usage.total_tokens` from API responses
- 429 response header parsing for differentiated cooldowns (RPM vs TPM vs RPD)
- Custom token counter injection via `tokenCounter` config option
- `PRESETS` object exported for programmatic access to provider rate limit configurations
- New exported types: `QuotaConfig`, `HealthConfig`, `ProviderPreset`, `KeyCooldownError`

### Changed

- `KeyPoolConfig` extended with optional `quotas`, `health`, and `tokenCounter` fields (fully backward compatible)

## [0.1.0] - 2026-04-15

### Added

- `KeyPool` class extending `OpenAI` — drop-in replacement with transparent key rotation on 429
- Round-robin key rotation strategy (O(1), deterministic)
- Least-recently-used (LRU) key rotation strategy (O(N), recommended for Gemini free tier)
- `KeyPoolExhaustedError` thrown when all keys are rate-limited, with masked keys and original cause
- `maskKey()` utility for safe API key logging (shows first 4 and last 4 characters)
- `onExhausted` callback option for custom alerting or logging when all keys are exhausted
- Full TypeScript types shipped with the package — no `@types/` package needed
- ESM and CJS dual output with TypeScript declarations

[0.1.0]: https://github.com/iammalego/keymux/releases/tag/v0.1.0
