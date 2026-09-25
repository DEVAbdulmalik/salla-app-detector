# Salla App Detector

Paste the URL of a store built on the Salla platform and get back what it runs.

Detection reads what the storefront actually serves — app snippets, built-in integrations,
inline app code, third-party scripts, the theme the store declares, and, for dropshipping,
the store's public product data. Every finding carries the evidence behind it.

Apps that run only between Salla and a vendor's server (shipping, accounting, messaging)
leave no public trace and are out of scope, so "not detected" never means "not installed".

## A report contains

| Section        | Where it comes from                                                                  |
| -------------- | ------------------------------------------------------------------------------------ |
| Apps           | Fingerprints matched against the page, each with its evidence and a confidence level |
| Theme          | The store declares it; the catalogue supplies the name, developer and version        |
| Integrations   | Salla's built-in services, read from the page configuration                          |
| Payments       | Methods and instalment providers the merchant enabled                                |
| Dropshipping   | Product image hosts and SKU shapes, matched by proportion                            |
| Unknown traces | What nothing explained yet, collected for the learning loop                          |

## Quick start

Node.js 24 (see `.node-version`) and pnpm 12.

```bash
pnpm install
cp .env.example .env.local
pnpm check
pnpm cli scan mahwous.com
```

Any link to a store works: its own domain, a `salla.sa` handle, or a product page.

## How it is built

| Path                 | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `packages/shared`    | Result type, structured logger, environment validation              |
| `packages/engine`    | Pure detection: parse a page, gather evidence, match, score, report |
| `packages/salla`     | Clients for Salla's storefront, marketplace and theme endpoints     |
| `packages/knowledge` | Apps, themes, fingerprints, noise, and the snapshot they compile to |
| `packages/jobs`      | Scanning, catalogue sync, learning loop, monitoring                 |
| `apps/web`           | Next.js front end, public API, admin panel                          |
| `tools/cli`          | Local commands for scanning and maintaining the knowledge base      |

The engine never performs I/O. It takes a page and a knowledge snapshot and returns a
report, so the whole detection path is testable offline against saved pages. Fetching lives
in `packages/salla`, where requests reach public addresses only, every response is checked
against a schema, and requests to one host are paced so a burst is queued rather than
refused.

## Knowledge base

Detection reads a Postgres database holding the app catalogue, the theme catalogue, the
fingerprints pointing at apps, and the platform background to ignore. Without a database it
falls back to the knowledge bundled in `packages/knowledge`.

Every report records the engine version and the knowledge version that produced it, so any
result can be reproduced.

A fingerprint on paper is not coverage. Most apps get one automatically from their
developer's domain, and most of those domains never appear on a storefront. `coverage`
reports what counts instead: apps that have turned up in live stores, and fingerprints that
have matched a real page.

Most of the database can be rebuilt: apps and themes come back from Salla, generated
fingerprints from the next sync. What cannot is what people decided — hand-written and
approved fingerprints, noise added by hand, review decisions, canaries and ground truth.
`db export` saves exactly that. To rebuild from nothing: `db migrate`, `db import`,
`sync catalog`, then `db restore` with the latest backup.

## Commands

| Command                                 | What it does                                                   |
| --------------------------------------- | -------------------------------------------------------------- |
| `pnpm check`                            | Types, lint, formatting and tests                              |
| `pnpm cli scan <url>`                   | Scan one store (`--json` for the full report)                  |
| `pnpm cli crawl --file <path>`          | Scan and record a list of stores, which feeds learning         |
| `pnpm cli harvest`                      | Grow the corpus from the stores that reviewed each app         |
| `pnpm cli db migrate`                   | Create or update the schema                                    |
| `pnpm cli db import`                    | Load the bundled knowledge into an empty database              |
| `pnpm cli db snapshot`                  | Show what the database currently knows                         |
| `pnpm cli db export [dir]`              | Back up what people decided (beside the repository by default) |
| `pnpm cli db restore <file>`            | Load such a backup into a database                             |
| `pnpm cli sync catalog`                 | Refresh apps and regenerate their fingerprints                 |
| `pnpm cli sync themes`                  | Refresh the theme catalogue                                    |
| `pnpm cli learn`                        | Turn unexplained traces into candidates                        |
| `pnpm cli validate <signal> --app <id>` | Check a proposed fingerprint against stores running the app    |
| `pnpm cli health`                       | Run the monitoring checks now                                  |
| `pnpm cli canary <url> ...`             | Watch a store whose apps are known (`--list` to see them)      |
| `pnpm cli quality-report`               | Measure detection against known installations                  |
| `pnpm cli coverage`                     | How much of the catalogue detection has actually seen          |

`sync catalog` works to a time budget and saves its place, so a large refresh can span
several scheduled runs. `harvest` works the same way: merchants who review an app almost
always run it, so each reviewer store is recorded as a known installation and scanned if
it has not been lately. It runs from an ordinary network, since Salla refuses the
deployment's addresses, and stops by itself if stores begin to refuse it too.

## Running it in production

The web app is deployed on Vercel, the database is Supabase, and two schedules keep the
knowledge current: the catalogue and theme sync at 02:00, and the learning loop at 03:00,
which also runs the monitoring checks. Both endpoints require the `CRON_SECRET` bearer
token. `GET /api/health?deep=1` reports the region, the knowledge version, database timings
and which optional settings the deployment received.

Two things are worth knowing before changing the deployment:

- **Region matters twice.** Serverless functions far from the database spend most of a scan
  waiting on the network, and some of Salla's own hosts refuse requests from certain
  regions outright.
- **Some of Salla's sites refuse the deployment.** The theme store answers Frankfurt with a
  Cloudflare challenge, so the nightly theme refresh is expected to fail there. Themes
  change slowly; run `pnpm cli sync themes` from an ordinary network when the alert says
  the catalogue is two weeks old.
- **Canaries define themselves.** A canary's expectation is whatever detection finds on the
  day it is added, so add canaries only from stores you have looked at.

### What the alerts mean

| Alert                  | Reading                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `canary-missing-app`   | One store lost one app: that app's fingerprint is probably stale. Scan the store, see what changed, promote a replacement from the queue.      |
| `canary-sweep`         | Several canaries lost apps at once: Salla changed something structural. Compare a saved page with a fresh one before touching any fingerprint. |
| `blocked-rate`         | A quarter of recent scans came back blocked. Usually the hosting addresses are being challenged; check from another network first.             |
| `fingerprint-silent`   | An app detected across several stores last week and none this week. Treat as a stale fingerprint.                                              |
| `unmapped-service-key` | Salla added a built-in integration. Map the key to an app, or ignore it if the platform provides it directly.                                  |
| `api-contract`         | An endpoint we read no longer answers the shape we parse. Check it before trusting new reports.                                                |
| `job-not-running`      | A schedule has not finished well for too long — a day and a half for daily jobs, two weeks for themes. The last status says why.               |
| `request-failed`       | An unexpected error in a page or an endpoint, recorded where the other alerts live.                                                            |

## Note

This project is independent and is not affiliated with or endorsed by Salla.
