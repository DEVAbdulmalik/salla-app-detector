# Salla App Detector

Paste the URL of a store built on the Salla platform and get back the apps it uses.

Detection reads what the storefront actually serves: app snippets, built-in integrations,
inline app code, third-party scripts, and — for dropshipping apps — the store's public
product data. Every finding is reported with the evidence behind it and a confidence
level. Apps that run only between Salla and a vendor's server (shipping, accounting,
messaging) leave no public trace and are out of scope, so a result of "not detected" never
means "not installed".

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

The engine never performs I/O. It takes a page and a knowledge snapshot and returns a
report, which keeps the whole detection path testable offline against saved pages. Fetching
lives in `packages/salla`, where requests are restricted to public addresses and every
response is validated against a schema.

## Requirements

- Node.js 24 (see `.node-version`)
- pnpm 12 (`npm install -g pnpm@12`)

## Getting started

```bash
pnpm install
cp .env.example .env.local
pnpm check
```

## Scanning a store

```bash
pnpm cli scan mahwous.com          # readable summary
pnpm cli scan mahwous.com --json   # the full report
```

Any link to the store works: its own domain, a `salla.sa` handle, or a product page.

## Knowledge base

Detection reads from a Postgres database that holds the app catalogue, the fingerprints
that point at those apps, and the platform background to ignore. Without a database the
scanner falls back to the knowledge bundled in `packages/knowledge`.

```bash
pnpm cli db migrate      # create or update the schema
pnpm cli db import       # load the bundled knowledge into an empty database
pnpm cli db snapshot     # show what the database currently knows
pnpm cli sync catalog    # refresh the catalogue and regenerate fingerprints
```

`sync catalog` works within a time budget and saves its place, so a large refresh can span
several scheduled runs. Set `DATABASE_URL` in `.env.local`; see `.env.example`.

## Running it in production

The web app is deployed on Vercel and the database is Supabase. Two schedules keep the
knowledge current: the catalogue sync at 02:00 and the learning loop at 03:00, which also
runs the monitoring checks. Both endpoints require the `CRON_SECRET` bearer token.

Keep the serverless functions in the same region as the database. A scan that crosses
continents spends most of its time waiting on the network rather than on the store.

```bash
pnpm cli health                  # run the monitoring checks now
pnpm cli canary <url> ...        # watch a store whose apps are known
pnpm cli canary --list
pnpm cli quality-report          # measure detection against known installations
pnpm cli validate <signal> --app <id>   # check a proposed fingerprint
```

### What the alerts mean

| Alert                  | Reading                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `canary-missing-app`   | One store lost one app: that app's fingerprint is probably stale. Scan the store, look at what changed, and promote a replacement from the candidate queue.                          |
| `canary-sweep`         | Several canaries lost apps at once: Salla changed something structural. Compare a saved page with a fresh one before touching any fingerprint.                                       |
| `blocked-rate`         | A quarter of recent scans came back blocked. Usually the hosting provider's addresses are being challenged; check from a different network before assuming the detector is at fault. |
| `fingerprint-silent`   | An app detected across several stores last week and none this week. Treat like a stale fingerprint.                                                                                  |
| `unmapped-service-key` | Salla added a built-in integration. Map the key to an app in the services table.                                                                                                     |

The canary expectation is whatever detection finds on the day the canary is added, so add
canaries only from stores you have looked at.

## Scripts

| Command               | Description                          |
| --------------------- | ------------------------------------ |
| `pnpm check`          | Types, lint, formatting, and tests   |
| `pnpm cli scan <url>` | Scan one store from the terminal     |
| `pnpm typecheck`      | TypeScript across every package      |
| `pnpm lint`           | ESLint, warnings treated as failures |
| `pnpm format`         | Apply Prettier                       |
| `pnpm test`           | Vitest once                          |
| `pnpm test:watch`     | Vitest in watch mode                 |
| `pnpm test:coverage`  | Vitest with coverage                 |
| `pnpm cli health`     | Run the monitoring checks            |

## Note

This project is independent and is not affiliated with or endorsed by Salla.
