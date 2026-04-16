# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
