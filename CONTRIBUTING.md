# Contributing

## Development Setup

Clone the repository and install dependencies:

```sh
git clone https://github.com/iammalego/keymux.git
cd keymux
npm install
```

Available commands:

- `npm test` — run tests
- `npm run test:coverage` — run tests with coverage
- `npm run lint` — check code style
- `npm run lint:fix` — fix auto-fixable style issues
- `npm run type-check` — TypeScript type checking
- `npm run build` — build dist/

## Pull Request Process

- Fork the repo, create a branch from `main`
- Follow strict TDD — write tests BEFORE implementation, every PR must include tests for new behavior
- Run the full check suite before pushing: `npm run lint && npm run type-check && npm test && npm run build`
- Open PR against `main`, fill in the PR template, link the issue it closes

## Coding Standards

- TypeScript strict mode — no `any`, no `ts-ignore` without justification
- Biome for formatting and linting — run `npm run lint:fix` before committing
- Co-locate test files with source (`scheduler.test.ts` next to `scheduler.ts`)

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `chore:` — build, tooling, or maintenance

Keep messages in lowercase, imperative mood: `feat: add round-robin strategy` not `Added round-robin strategy`
