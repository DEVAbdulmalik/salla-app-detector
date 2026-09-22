import {
  fnv1a,
  type AppInfo,
  type AppStatus,
  type EvidenceKind,
  type Fingerprint,
  type FingerprintStrength,
  type KnowledgeSnapshot,
  type NoiseRules,
} from "@salla-app-detector/engine";
import type { Database } from "./executor";

export type FingerprintSource = "auto" | "mined" | "manual";
export type FingerprintStatus = "active" | "candidate" | "disabled";
export type NoiseKind = keyof NoiseRules;

export interface AppUpsert {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly company?: string;
  readonly categories?: readonly string[];
  readonly status?: AppStatus;
  readonly isDefault?: boolean;
  readonly installs?: number;
}

export interface FingerprintUpsert {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly pattern: string;
  readonly strength: FingerprintStrength;
  readonly source: FingerprintSource;
  readonly status?: FingerprintStatus;
  readonly appId?: string;
  readonly company?: string;
  readonly companyAppIds?: readonly string[];
  readonly minProductShare?: number;
}

export interface NoiseUpsert {
  readonly kind: NoiseKind;
  readonly pattern: string;
  readonly reason?: string;
}

export interface StaleApp {
  readonly id: string;
}

export interface AppDomains {
  readonly id: string;
  readonly company: string | null;
  readonly domains: string[];
}

export interface JobState {
  readonly cursor: Record<string, unknown>;
  readonly lastRunAt?: Date;
  readonly lastStatus?: string;
}

const NOISE_KINDS: readonly NoiseKind[] = [
  "hosts",
  "domains",
  "identifiers",
  "inlineSignatures",
  "markers",
  "elementIds",
  "customElements",
];

export class KnowledgeRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  async upsertApps(apps: readonly AppUpsert[]): Promise<void> {
    if (apps.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into apps (id, name, name_en, company, categories, status, is_default, installs, last_seen_in_catalog_at, missing_from_catalog_runs, updated_at)
       select id, name, name_en, company, coalesce(categories, '{}'), status, is_default, installs, now(), 0, now()
       from jsonb_to_recordset($1::jsonb) as incoming(
         id text, name text, name_en text, company text, categories text[],
         status text, is_default boolean, installs int
       )
       on conflict (id) do update set
         name = excluded.name,
         name_en = excluded.name_en,
         company = excluded.company,
         categories = excluded.categories,
         -- A vendor we named ourselves keeps that status even if the catalogue lists it later.
         status = case when apps.status = 'unidentified' then apps.status else excluded.status end,
         is_default = excluded.is_default or apps.is_default,
         installs = excluded.installs,
         last_seen_in_catalog_at = excluded.last_seen_in_catalog_at,
         missing_from_catalog_runs = 0,
         updated_at = now()`,
      [
        JSON.stringify(
          apps.map((app) => ({
            id: app.id,
            name: app.name,
            name_en: app.nameEn ?? null,
            company: app.company ?? null,
            categories: app.categories ?? [],
            status: app.status ?? "listed",
            is_default: app.isDefault ?? false,
            installs: app.installs ?? null,
          })),
        ),
      ],
    );
  }

  /**
   * Marks apps that a catalogue pass did not return. Two consecutive misses count as
   * removed from the marketplace; the app itself is kept, because stores still run it.
   */
  async markAppsMissingFromCatalog(seenIds: readonly string[]): Promise<string[]> {
    const rows = await this.#db.query<{ id: string }>(
      `update apps set
         missing_from_catalog_runs = missing_from_catalog_runs + 1,
         status = case when missing_from_catalog_runs + 1 >= 2 and status = 'listed' then 'delisted' else status end,
         updated_at = now()
       where status <> 'unidentified' and not (id = any($1::text[]))
       returning id`,
      [seenIds],
    );
    return rows.map((row) => row.id);
  }

  async appsNeedingDetails(limit: number, staleBefore: Date): Promise<StaleApp[]> {
    return this.#db.query<StaleApp>(
      `select id from apps
       where status <> 'unidentified'
         and (details_fetched_at is null or details_fetched_at < $2)
       order by details_fetched_at asc nulls first, installs desc nulls last
       limit $1`,
      [limit, staleBefore],
    );
  }

  /** The app's own page is the better source for its vendor, so it wins over the catalogue. */
  async saveAppDetails(
    appId: string,
    domains: readonly string[],
    fetchedAt: Date,
    company?: string,
  ): Promise<void> {
    await this.#db.query(
      `update apps set
         developer_domains = $2::text[],
         details_fetched_at = $3,
         company = coalesce($4, company),
         updated_at = now()
       where id = $1`,
      [appId, domains, fetchedAt, company ?? null],
    );
  }

  /** Developer domains per app, the raw material for generated domain fingerprints. */
  async appDomains(): Promise<AppDomains[]> {
    return this.#db.query<AppDomains>(
      `select id, company, developer_domains as domains
       from apps
       where cardinality(developer_domains) > 0
       order by id`,
    );
  }

  async noiseDomains(): Promise<string[]> {
    const rows = await this.#db.query<{ pattern: string }>(
      "select pattern from noise_rules where kind in ('domains', 'hosts')",
    );
    return rows.map((row) => row.pattern);
  }

  async upsertFingerprints(fingerprints: readonly FingerprintUpsert[]): Promise<void> {
    if (fingerprints.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into fingerprints (id, kind, pattern, strength, source, status, app_id, company, company_app_ids, min_product_share)
       select id, kind, pattern, strength, source, status, app_id, company,
              coalesce(company_app_ids, '{}'), min_product_share
       from jsonb_to_recordset($1::jsonb) as incoming(
         id text, kind text, pattern text, strength text, source text, status text,
         app_id text, company text, company_app_ids text[], min_product_share real
       )
       on conflict (id) do update set
         kind = excluded.kind,
         pattern = excluded.pattern,
         strength = excluded.strength,
         source = excluded.source,
         status = excluded.status,
         app_id = excluded.app_id,
         company = excluded.company,
         company_app_ids = excluded.company_app_ids,
         min_product_share = excluded.min_product_share,
         updated_at = now()`,
      [
        JSON.stringify(
          fingerprints.map((item) => ({
            id: item.id,
            kind: item.kind,
            pattern: item.pattern,
            strength: item.strength,
            source: item.source,
            status: item.status ?? "active",
            app_id: item.appId ?? null,
            company: item.company ?? null,
            company_app_ids: item.companyAppIds ?? [],
            min_product_share: item.minProductShare ?? null,
          })),
        ),
      ],
    );
  }

  /** Removes generated fingerprints that a refresh no longer produces. */
  async removeAutoFingerprints(keepIds: readonly string[]): Promise<number> {
    const rows = await this.#db.query<{ id: string }>(
      `delete from fingerprints
       where source = 'auto' and not (id = any($1::text[]))
       returning id`,
      [keepIds],
    );
    return rows.length;
  }

  async upsertNoiseRules(rules: readonly NoiseUpsert[]): Promise<void> {
    if (rules.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into noise_rules (kind, pattern, reason)
       select kind, pattern, reason
       from jsonb_to_recordset($1::jsonb) as incoming(kind text, pattern text, reason text)
       on conflict (kind, pattern) do update set reason = excluded.reason`,
      [
        JSON.stringify(
          rules.map((rule) => ({
            kind: rule.kind,
            pattern: rule.pattern,
            reason: rule.reason ?? null,
          })),
        ),
      ],
    );
  }

  async recordGroundTruth(
    entries: readonly { appId: string; storeId: number; observedOn?: string }[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into ground_truth (app_id, store_id, observed_on)
       select app_id, store_id, observed_on
       from jsonb_to_recordset($1::jsonb) as incoming(app_id text, store_id bigint, observed_on date)
       where exists (select 1 from apps where apps.id = incoming.app_id)
       on conflict (app_id, store_id) do update set observed_on = excluded.observed_on`,
      [
        JSON.stringify(
          entries.map((entry) => ({
            app_id: entry.appId,
            store_id: entry.storeId,
            observed_on: entry.observedOn ?? null,
          })),
        ),
      ],
    );
  }

  async jobState(job: string): Promise<JobState | undefined> {
    const rows = await this.#db.query<{
      cursor: Record<string, unknown>;
      last_run_at: Date | null;
      last_status: string | null;
    }>("select cursor, last_run_at, last_status from job_state where job = $1", [job]);
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      cursor: row.cursor,
      ...(row.last_run_at === null ? {} : { lastRunAt: row.last_run_at }),
      ...(row.last_status === null ? {} : { lastStatus: row.last_status }),
    };
  }

  async saveJobState(
    job: string,
    cursor: Record<string, unknown>,
    status: string,
    ranAt: Date,
  ): Promise<void> {
    await this.#db.query(
      `insert into job_state (job, cursor, last_run_at, last_status, updated_at)
       values ($1, $2::jsonb, $3, $4, now())
       on conflict (job) do update set
         cursor = excluded.cursor,
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         updated_at = now()`,
      [job, JSON.stringify(cursor), ranAt, status],
    );
  }

  /** Assembles everything the engine needs for a scan, with a version derived from it. */
  async loadSnapshot(): Promise<KnowledgeSnapshot> {
    const [appRows, fingerprintRows, noiseRows] = await Promise.all([
      this.#db.query<{
        id: string;
        name: string;
        name_en: string | null;
        company: string | null;
        categories: string[];
        status: AppStatus;
        is_default: boolean;
      }>("select id, name, name_en, company, categories, status, is_default from apps order by id"),
      this.#db.query<{
        id: string;
        kind: EvidenceKind;
        pattern: string;
        strength: FingerprintStrength;
        app_id: string | null;
        company: string | null;
        company_app_ids: string[];
        min_product_share: number | null;
      }>(
        `select id, kind, pattern, strength, app_id, company, company_app_ids, min_product_share
         from fingerprints where status = 'active' order by id`,
      ),
      this.#db.query<{ kind: NoiseKind; pattern: string }>(
        "select kind, pattern from noise_rules order by kind, pattern",
      ),
    ]);

    const apps: Record<string, AppInfo> = {};
    for (const row of appRows) {
      apps[row.id] = {
        id: row.id,
        name: row.name,
        ...(row.name_en === null ? {} : { nameEn: row.name_en }),
        ...(row.company === null ? {} : { company: row.company }),
        categories: row.categories,
        status: row.status,
        ...(row.is_default ? { isDefault: true } : {}),
      };
    }

    const fingerprints: Fingerprint[] = fingerprintRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      pattern: row.pattern,
      strength: row.strength,
      target:
        row.app_id === null
          ? { type: "company", company: row.company ?? row.id, appIds: row.company_app_ids }
          : { type: "app", appId: row.app_id },
      ...(row.min_product_share === null ? {} : { minProductShare: row.min_product_share }),
    }));

    const noise = emptyNoise();
    for (const row of noiseRows) {
      if (NOISE_KINDS.includes(row.kind)) {
        noise[row.kind].push(row.pattern);
      }
    }

    return {
      version: `db-${fnv1a(JSON.stringify([appRows, fingerprintRows, noiseRows]))}`,
      apps,
      fingerprints,
      noise,
    };
  }
}

function emptyNoise(): Record<NoiseKind, string[]> {
  return {
    hosts: [],
    domains: [],
    identifiers: [],
    inlineSignatures: [],
    markers: [],
    elementIds: [],
    customElements: [],
  };
}
