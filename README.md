# Salla App Detector

Paste the URL of a store built on the Salla platform and get back the apps it uses.

Detection reads what the storefront actually serves: app snippets, built-in integrations,
inline app code, third-party scripts, and — for dropshipping apps — the store's public
product data. Every finding is reported with the evidence behind it and a confidence
level. Apps that run only between Salla and a vendor's server (shipping, accounting,
messaging) leave no public trace and are out of scope, so a result of "not detected" never
means "not installed".

## Status

Under construction. The foundation is in place; the detection engine is next.

## Layout

| Path                 | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `packages/shared`    | Result type, structured logger, environment validation              |
| `packages/engine`    | Pure detection: parse a page, gather evidence, match, score, report |
| `packages/salla`     | Clients for Salla's storefront and marketplace endpoints            |
| `packages/knowledge` | Fingerprint store, snapshot building                                |
| `packages/jobs`      | Scanning, catalog sync, learning loop, health checks                |
| `apps/web`           | Next.js front end, public API, admin                                |
| `tools/cli`          | Local commands for scanning and maintaining the knowledge base      |

Only `packages/shared` exists today; the rest arrive with the work that needs them.

The engine never performs I/O. It takes a page and a knowledge snapshot and returns a
report, which keeps the whole detection path testable offline against saved pages.

## Requirements

- Node.js 24 (see `.node-version`)
- pnpm 12 (`npm install -g pnpm@12`)

## Getting started

```bash
pnpm install
cp .env.example .env.local
pnpm check
```

## Scripts

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `pnpm check`         | Types, lint, formatting, and tests   |
| `pnpm typecheck`     | TypeScript across every package      |
| `pnpm lint`          | ESLint, warnings treated as failures |
| `pnpm format`        | Apply Prettier                       |
| `pnpm test`          | Vitest once                          |
| `pnpm test:watch`    | Vitest in watch mode                 |
| `pnpm test:coverage` | Vitest with coverage                 |

## Note

This project is independent and is not affiliated with or endorsed by Salla.
