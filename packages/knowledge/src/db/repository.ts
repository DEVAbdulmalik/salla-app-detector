import {
  fnv1a,
  type AppInfo,
  type AppStatus,
  type EvidenceKind,
  type Fingerprint,
  type FingerprintStrength,
  type KnowledgeSnapshot,
  type NoiseRules,
  type ThemeInfo,
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

export interface ScanRecord {
  readonly storeKey: string;
  readonly storeId?: number;
  readonly status: string;
  readonly report: unknown;
  readonly engineVersion: string;
  readonly knowledgeVersion: string;
  readonly durationMs: number;
}

export interface StoredScan {
  readonly report: unknown;
  readonly scannedAt: Date;
}

export interface RateLimit {
  readonly allowed: boolean;
  readonly hits: number;
  readonly remaining: number;
}

export interface SignalCluster {
  readonly signalKind: string;
  readonly signalValue: string;
  readonly storeCount: number;
  readonly sample?: string;
}

export interface CandidateUpsert {
  readonly signalKind: string;
  readonly signalValue: string;
  readonly storeCount: number;
  readonly suggestedAppId?: string;
  /** Set when the trace belongs to a theme rather than to any app. */
  readonly themeId?: string;
  readonly sample?: string;
}

export interface ThemeConcentration {
  readonly signalKind: string;
  readonly signalValue: string;
  readonly themeId: string;
  readonly themeName: string | null;
  readonly share: number;
}

export interface CandidateRow extends SignalCluster {
  readonly themeId?: string;
  readonly themeName?: string;
  readonly status: string;
  readonly suggestedAppId?: string;
  readonly suggestedAppName?: string;
}

export interface CanaryStore {
  readonly storeUrl: string;
  readonly expectedAppIds: readonly string[];
  readonly expectedServices: readonly string[];
  readonly note?: string;
}

export interface StoreDetections {
  readonly storeKey: string;
  readonly appIds: readonly string[];
}

export interface GroundTruthRow {
  readonly appId: string;
  readonly appName: string;
  readonly storeId: string;
}

export interface ThemeUpsert {
  readonly id: string;
  readonly name: string;
  readonly developer?: string;
  readonly version?: string;
  readonly rating?: number;
  readonly ratingsCount?: number;
  readonly isBeta?: boolean;
  readonly listingId?: string;
}

export interface FingerprintRow {
  readonly id: string;
  readonly kind: string;
  readonly pattern: string;
  readonly strength: FingerprintStrength;
  readonly source: FingerprintSource;
  readonly status: FingerprintStatus;
  readonly appId?: string;
  readonly appName?: string;
  readonly company?: string;
  readonly matchCount: number;
  readonly lastMatchedAt?: Date;
}

export interface NoiseRow {
  readonly kind: string;
  readonly pattern: string;
  readonly reason?: string;
}

export interface ScanRow {
  readonly id: string;
  readonly storeKey: string;
  readonly status: string;
  readonly appCount: number;
  readonly unknownCount: number;
  readonly durationMs: number;
  readonly scannedAt: Date;
}

export interface StatusShare {
  readonly status: string;
  readonly stores: number;
}

export interface JobRun {
  readonly job: string;
  readonly lastRunAt?: Date;
  readonly lastStatus?: string;
  /** When the job last finished well, which a nightly failure does not move. */
  readonly lastSuccessAt?: Date;
}

export interface HealthEvent {
  readonly kind: string;
  readonly severity: "info" | "warning" | "critical";
  readonly detail?: Record<string, unknown>;
}

export interface HealthEventRow {
  readonly id: string;
  readonly kind: string;
  readonly severity: string;
  readonly detail: Record<string, unknown>;
  readonly createdAt: Date;
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
       from jsonb_to_recordset($1::text::jsonb) as incoming(
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

  /**
   * Stores a finished scan. The report is kept whole so a shared link can be rendered
   * later without scanning again, and so a past result stays explainable.
   */
  async recordScan(entry: ScanRecord): Promise<void> {
    await this.#db.query(
      `insert into scans (store_key, store_id, status, report, engine_version, knowledge_version, duration_ms)
       values ($1, $2, $3, $4::text::jsonb, $5, $6, $7)`,
      [
        entry.storeKey,
        entry.storeId ?? null,
        entry.status,
        JSON.stringify(entry.report),
        entry.engineVersion,
        entry.knowledgeVersion,
        entry.durationMs,
      ],
    );
  }

  async recentScan(storeKey: string, maxAgeMinutes: number): Promise<StoredScan | undefined> {
    const rows = await this.#db.query<{ report: unknown; scanned_at: Date }>(
      `select report, scanned_at from scans
       where store_key = $1 and scanned_at > now() - make_interval(mins => $2)
       order by scanned_at desc
       limit 1`,
      [storeKey, maxAgeMinutes],
    );
    const row = rows[0];
    return row === undefined ? undefined : { report: row.report, scannedAt: row.scanned_at };
  }

  /** Signals a scan could not explain, which the learning loop later clusters. */
  async recordObservations(
    storeKey: string,
    signals: readonly { kind: string; value: string; sample?: string }[],
  ): Promise<void> {
    if (signals.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into observations (signal_kind, signal_value, store_key, sample)
       select signal_kind, signal_value, $2, sample
       from jsonb_to_recordset($1::text::jsonb) as incoming(signal_kind text, signal_value text, sample text)
       on conflict (signal_kind, signal_value, store_key) do update set last_seen_at = now()`,
      [
        JSON.stringify(
          signals.map((signal) => ({
            signal_kind: signal.kind,
            signal_value: signal.value,
            sample: signal.sample ?? null,
          })),
        ),
        storeKey,
      ],
    );
  }

  /** Builds the index that lets a review avatar be traced back to the store behind it. */
  async rememberStoreCode(code: string, storeId: number | undefined, host: string): Promise<void> {
    await this.#db.query(
      `insert into store_codes (code, store_id, store_key)
       values ($1, $2, $3)
       on conflict (code) do update set
         store_id = coalesce(excluded.store_id, store_codes.store_id),
         store_key = excluded.store_key,
         seen_at = now()`,
      [code, storeId ?? null, host],
    );
  }

  /** The other direction: avatar codes back to the storefronts a scan has already seen. */
  async storeKeysByCode(codes: readonly string[]): Promise<Map<string, string>> {
    if (codes.length === 0) {
      return new Map();
    }
    const rows = await this.#db.query<{ code: string; store_key: string }>(
      `select code, store_key from store_codes
        where store_key is not null and code = any($1::text[])`,
      [codes],
    );
    return new Map(rows.map((row) => [row.code, row.store_key]));
  }

  /**
   * Counts one request against a fixed window and reports whether it is allowed. The
   * insert settles the count in a single statement, so simultaneous requests cannot slip
   * past the limit between a read and a write.
   */
  async consumeRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<RateLimit> {
    const rows = await this.#db.query<{ hits: number }>(
      `insert into rate_limits (bucket, window_start, hits)
       values ($1, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
       on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
       returning hits`,
      [bucket, windowSeconds],
    );
    const hits = rows[0]?.hits ?? 1;
    return { allowed: hits <= limit, hits, remaining: Math.max(0, limit - hits) };
  }

  async forgetOldRateLimits(olderThanSeconds: number): Promise<void> {
    await this.#db.query(
      "delete from rate_limits where window_start < now() - make_interval(secs => $1)",
      [olderThanSeconds],
    );
  }

  /** Signals seen across enough distinct stores to be worth investigating. */
  async signalClusters(minimumStores: number): Promise<SignalCluster[]> {
    return this.#db.query<SignalCluster>(
      `select signal_kind as "signalKind",
              signal_value as "signalValue",
              count(distinct store_key)::int as "storeCount",
              min(sample) as sample
       from observations
       group by signal_kind, signal_value
       having count(distinct store_key) >= $1
       order by count(distinct store_key) desc`,
      [minimumStores],
    );
  }

  /**
   * How often a signal shows up across recently scanned stores. A fingerprint is only
   * worth having when it is common in one app's stores and rare in everyone else's.
   */
  async signalShareAcrossScans(
    signalKind: string,
    signalValue: string,
    days: number,
  ): Promise<number> {
    const rows = await this.#db.query<{ share: string }>(
      `with scanned as (
         select distinct store_key from scans
         where scanned_at > now() - make_interval(days => $3::int) and status = 'live'
       ), carrying as (
         select distinct store_key from observations
         where signal_kind = $1 and signal_value = $2
           and store_key in (select store_key from scanned)
       )
       select coalesce(
         (select count(*)::numeric from carrying) / nullif((select count(*) from scanned), 0),
         0
       )::text as share`,
      [signalKind, signalValue, days],
    );
    return Number(rows[0]?.share ?? 0);
  }

  async recentScanCount(days: number): Promise<number> {
    const rows = await this.#db.query<{ count: string }>(
      `select count(distinct store_key)::text as count from scans
       where scanned_at > now() - make_interval(days => $1::int) and status = 'live'`,
      [days],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Developer domains mapped to the apps that claim them. */
  async domainOwners(): Promise<Map<string, string[]>> {
    const rows = await this.#db.query<{ domain: string; app_ids: string[] }>(
      `select domain, array_agg(id order by id) as app_ids
       from apps, unnest(developer_domains) as domain
       group by domain`,
    );
    return new Map(rows.map((row) => [row.domain, row.app_ids]));
  }

  /**
   * For each unexplained signal, the theme most of its stores run. An asset belonging to a
   * theme shows up on every store using that theme and almost nowhere else, which is what
   * separates it from an app that merchants install regardless of how their store looks.
   */
  async signalThemeConcentration(minimumStores: number): Promise<ThemeConcentration[]> {
    return this.#db.query<ThemeConcentration>(
      `with latest as (
         select distinct on (store_key) store_key, report->'store'->>'theme' as theme_id
         from scans where status = 'live'
         order by store_key, scanned_at desc
       ), tallied as (
         select o.signal_kind, o.signal_value, latest.theme_id, count(distinct o.store_key)::int as stores
         from observations o
         join latest on latest.store_key = o.store_key
         where latest.theme_id is not null
         group by 1, 2, 3
       ), totals as (
         select signal_kind, signal_value, sum(stores)::int as total
         from tallied group by 1, 2
       )
       select distinct on (t.signal_kind, t.signal_value)
              t.signal_kind as "signalKind",
              t.signal_value as "signalValue",
              t.theme_id as "themeId",
              th.name as "themeName",
              (t.stores::numeric / totals.total)::float8 as share
       from tallied t
       join totals on totals.signal_kind = t.signal_kind and totals.signal_value = t.signal_value
       left join themes th on th.id = t.theme_id
       where totals.total >= $1
       order by t.signal_kind, t.signal_value, t.stores desc`,
      [minimumStores],
    );
  }

  async upsertCandidates(candidates: readonly CandidateUpsert[]): Promise<void> {
    if (candidates.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into candidates (signal_kind, signal_value, store_count, suggested_app_id, theme_id, sample)
       select signal_kind, signal_value, store_count, suggested_app_id, theme_id, sample
       from jsonb_to_recordset($1::text::jsonb) as incoming(
         signal_kind text, signal_value text, store_count int,
         suggested_app_id text, theme_id text, sample text
       )
       on conflict (signal_kind, signal_value) do update set
         store_count = excluded.store_count,
         -- A decision already made by a person is never overwritten by a later run.
         suggested_app_id = coalesce(candidates.suggested_app_id, excluded.suggested_app_id),
         theme_id = excluded.theme_id,
         sample = coalesce(candidates.sample, excluded.sample),
         updated_at = now()`,
      [
        JSON.stringify(
          candidates.map((candidate) => ({
            signal_kind: candidate.signalKind,
            signal_value: candidate.signalValue,
            store_count: candidate.storeCount,
            suggested_app_id: candidate.suggestedAppId ?? null,
            theme_id: candidate.themeId ?? null,
            sample: candidate.sample ?? null,
          })),
        ),
      ],
    );
  }

  async listCandidates(status: string, limit = 50): Promise<CandidateRow[]> {
    const rows = await this.#db.query<{
      signalKind: string;
      signalValue: string;
      storeCount: number;
      status: string;
      sample: string | null;
      suggestedAppId: string | null;
      suggestedAppName: string | null;
      themeId: string | null;
      themeName: string | null;
    }>(
      `select c.signal_kind as "signalKind",
              c.signal_value as "signalValue",
              c.store_count as "storeCount",
              c.status,
              c.sample,
              c.suggested_app_id as "suggestedAppId",
              a.name as "suggestedAppName",
              c.theme_id as "themeId",
              t.name as "themeName"
       from candidates c
       left join apps a on a.id = c.suggested_app_id
       left join themes t on t.id = c.theme_id
       where c.status = $1
       order by c.store_count desc
       limit $2`,
      [status, limit],
    );

    // Absent columns come back as null; the domain types use optional fields instead.
    return rows.map((row) => ({
      signalKind: row.signalKind,
      signalValue: row.signalValue,
      storeCount: row.storeCount,
      status: row.status,
      ...(row.sample === null ? {} : { sample: row.sample }),
      ...(row.suggestedAppId === null ? {} : { suggestedAppId: row.suggestedAppId }),
      ...(row.suggestedAppName === null ? {} : { suggestedAppName: row.suggestedAppName }),
      ...(row.themeId === null ? {} : { themeId: row.themeId }),
      ...(row.themeName === null ? {} : { themeName: row.themeName }),
    }));
  }

  /** Signals already in the queue, whatever a reviewer decided about them. */
  async candidateSignalValues(kind: string): Promise<string[]> {
    const rows = await this.#db.query<{ signal_value: string }>(
      "select signal_value from candidates where signal_kind = $1",
      [kind],
    );
    return rows.map((row) => row.signal_value);
  }

  async setCandidateStatus(signalKind: string, signalValue: string, status: string): Promise<void> {
    await this.#db.query(
      "update candidates set status = $3, updated_at = now() where signal_kind = $1 and signal_value = $2",
      [signalKind, signalValue, status],
    );
  }

  /** Everything the panel needs to review one fingerprint, newest matches first. */
  async searchFingerprints(term: string, limit = 60): Promise<FingerprintRow[]> {
    const rows = await this.#db.query<{
      id: string;
      kind: string;
      pattern: string;
      strength: FingerprintStrength;
      source: FingerprintSource;
      status: FingerprintStatus;
      app_id: string | null;
      app_name: string | null;
      company: string | null;
      match_count: string;
      last_matched_at: Date | null;
    }>(
      `select f.id, f.kind, f.pattern, f.strength, f.source, f.status,
              f.app_id, a.name as app_name, f.company,
              f.match_count::text, f.last_matched_at
       from fingerprints f
       left join apps a on a.id = f.app_id
       where $1 = '' or f.pattern ilike '%' || $1 || '%' or a.name ilike '%' || $1 || '%'
          or f.app_id = $1 or f.company ilike '%' || $1 || '%'
       order by f.status, f.match_count desc, f.pattern
       limit $2`,
      [term, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      pattern: row.pattern,
      strength: row.strength,
      source: row.source,
      status: row.status,
      ...(row.app_id === null ? {} : { appId: row.app_id }),
      ...(row.app_name === null ? {} : { appName: row.app_name }),
      ...(row.company === null ? {} : { company: row.company }),
      matchCount: Number(row.match_count),
      ...(row.last_matched_at === null ? {} : { lastMatchedAt: row.last_matched_at }),
    }));
  }

  /**
   * Counts the fingerprints a scan matched. It is what tells a stale fingerprint from an
   * unpopular one: both find nothing today, but only one of them used to find something.
   */
  async recordFingerprintMatches(
    signals: readonly { readonly kind: string; readonly value: string }[],
  ): Promise<void> {
    if (signals.length === 0) {
      return;
    }
    await this.#db.query(
      `update fingerprints f set
         match_count = f.match_count + 1,
         last_matched_at = now()
       from jsonb_to_recordset($1::text::jsonb) as matched(kind text, pattern text)
       where f.kind = matched.kind and f.pattern = matched.pattern`,
      [JSON.stringify(signals.map((signal) => ({ kind: signal.kind, pattern: signal.value })))],
    );
  }

  /** Disabling is preferred to deleting: a fingerprint that once matched is evidence. */
  async setFingerprintState(
    id: string,
    state: { status?: FingerprintStatus; strength?: FingerprintStrength },
  ): Promise<void> {
    await this.#db.query(
      `update fingerprints set
         status = coalesce($2, status),
         strength = coalesce($3, strength),
         updated_at = now()
       where id = $1`,
      [id, state.status ?? null, state.strength ?? null],
    );
  }

  async deleteFingerprint(id: string): Promise<void> {
    await this.#db.query("delete from fingerprints where id = $1", [id]);
  }

  async noiseRules(): Promise<NoiseRow[]> {
    const rows = await this.#db.query<{ kind: string; pattern: string; reason: string | null }>(
      "select kind, pattern, reason from noise_rules order by kind, pattern",
    );
    return rows.map((row) => ({
      kind: row.kind,
      pattern: row.pattern,
      ...(row.reason === null ? {} : { reason: row.reason }),
    }));
  }

  async deleteNoiseRule(kind: string, pattern: string): Promise<void> {
    await this.#db.query("delete from noise_rules where kind = $1 and pattern = $2", [
      kind,
      pattern,
    ]);
  }

  /** The scan history, for looking at what detection did on a particular store. */
  async recentScans(limit: number, term = ""): Promise<ScanRow[]> {
    const rows = await this.#db.query<{
      id: string;
      store_key: string;
      status: string;
      app_count: number;
      unknown_count: number;
      duration_ms: number;
      scanned_at: Date;
    }>(
      `select id::text, store_key, status,
              jsonb_array_length(coalesce(report->'apps', '[]'::jsonb)) as app_count,
              jsonb_array_length(coalesce(report->'unknownSignals', '[]'::jsonb)) as unknown_count,
              duration_ms, scanned_at
       from scans
       where $2 = '' or store_key ilike '%' || $2 || '%'
       order by scanned_at desc
       limit $1`,
      [limit, term],
    );

    return rows.map((row) => ({
      id: row.id,
      storeKey: row.store_key,
      status: row.status,
      appCount: row.app_count,
      unknownCount: row.unknown_count,
      durationMs: row.duration_ms,
      scannedAt: row.scanned_at,
    }));
  }

  /** Stores with a known set of apps, scanned daily to notice detection going quiet. */
  async canaries(): Promise<CanaryStore[]> {
    const rows = await this.#db.query<{
      store_url: string;
      expected_app_ids: string[];
      expected_services: string[];
      note: string | null;
    }>(
      `select store_url, expected_app_ids, expected_services, note
       from canaries order by store_url`,
    );
    return rows.map((row) => ({
      storeUrl: row.store_url,
      expectedAppIds: row.expected_app_ids,
      expectedServices: row.expected_services,
      ...(row.note === null ? {} : { note: row.note }),
    }));
  }

  async upsertCanaries(canaries: readonly CanaryStore[]): Promise<void> {
    if (canaries.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into canaries (store_url, expected_app_ids, expected_services, note)
       select store_url,
              coalesce(expected_app_ids, '{}'),
              coalesce(expected_services, '{}'),
              note
       from jsonb_to_recordset($1::text::jsonb) as incoming(
         store_url text, expected_app_ids text[], expected_services text[], note text
       )
       on conflict (store_url) do update set
         expected_app_ids = excluded.expected_app_ids,
         expected_services = excluded.expected_services,
         note = coalesce(excluded.note, canaries.note)`,
      [
        JSON.stringify(
          canaries.map((canary) => ({
            store_url: canary.storeUrl,
            expected_app_ids: canary.expectedAppIds,
            expected_services: canary.expectedServices,
            note: canary.note ?? null,
          })),
        ),
      ],
    );
  }

  /**
   * Stores whose last scan found several apps outright. They make good canaries: if a
   * fingerprint goes stale, one of these stores is where it shows first.
   */
  async storesWithConfirmedApps(limit: number, days = 30): Promise<StoreDetections[]> {
    return this.#db.query<StoreDetections>(
      `select store_key as "storeKey",
              array_agg(distinct app->>'appId') as "appIds"
       from scans, jsonb_array_elements(report->'apps') as app
       where status = 'live'
         and app->>'confidence' = 'confirmed'
         and scanned_at > now() - make_interval(days => $2::int)
       group by store_key
       having count(distinct app->>'appId') >= 2
       order by max(scanned_at) desc
       limit $1`,
      [limit, days],
    );
  }

  /** Stores we know run an app, which is what a quality report measures detection against. */
  async groundTruth(limit: number): Promise<GroundTruthRow[]> {
    return this.#db.query<GroundTruthRow>(
      `select g.app_id as "appId", g.store_id::text as "storeId", a.name as "appName"
       from ground_truth g join apps a on a.id = g.app_id
       order by g.app_id, g.store_id
       limit $1`,
      [limit],
    );
  }

  /**
   * Fingerprints a person wrote or approved. Generated ones are left out: the catalogue
   * sync rebuilds them, while these exist nowhere else.
   */
  async curatedFingerprints(): Promise<FingerprintUpsert[]> {
    const rows = await this.#db.query<{
      id: string;
      kind: EvidenceKind;
      pattern: string;
      strength: FingerprintStrength;
      source: FingerprintSource;
      status: FingerprintStatus;
      app_id: string | null;
      company: string | null;
      company_app_ids: string[];
      min_product_share: number | null;
    }>(
      `select id, kind, pattern, strength, source, status, app_id, company, company_app_ids, min_product_share
       from fingerprints where source in ('manual', 'mined') order by id`,
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      pattern: row.pattern,
      strength: row.strength,
      source: row.source,
      status: row.status,
      ...(row.app_id === null ? {} : { appId: row.app_id }),
      ...(row.company === null ? {} : { company: row.company }),
      ...(row.company_app_ids.length === 0 ? {} : { companyAppIds: row.company_app_ids }),
      ...(row.min_product_share === null ? {} : { minProductShare: row.min_product_share }),
    }));
  }

  /** Noise added after the seed, by a person or by the learning loop. */
  async curatedNoise(): Promise<NoiseUpsert[]> {
    const rows = await this.#db.query<{ kind: NoiseKind; pattern: string; reason: string | null }>(
      "select kind, pattern, reason from noise_rules where reason is distinct from 'seed' order by kind, pattern",
    );
    return rows.map((row) => ({
      kind: row.kind,
      pattern: row.pattern,
      ...(row.reason === null ? {} : { reason: row.reason }),
    }));
  }

  /** Every candidate with the decision taken on it, so a restore does not reopen the queue. */
  async candidateDecisions(): Promise<(CandidateUpsert & { readonly status: string })[]> {
    const rows = await this.#db.query<{
      signal_kind: string;
      signal_value: string;
      store_count: number;
      suggested_app_id: string | null;
      theme_id: string | null;
      sample: string | null;
      status: string;
    }>(
      `select signal_kind, signal_value, store_count, suggested_app_id, theme_id, sample, status
       from candidates order by signal_kind, signal_value`,
    );
    return rows.map((row) => ({
      signalKind: row.signal_kind,
      signalValue: row.signal_value,
      storeCount: row.store_count,
      status: row.status,
      ...(row.suggested_app_id === null ? {} : { suggestedAppId: row.suggested_app_id }),
      ...(row.theme_id === null ? {} : { themeId: row.theme_id }),
      ...(row.sample === null ? {} : { sample: row.sample }),
    }));
  }

  async groundTruthPairs(): Promise<{ appId: string; storeId: number; observedOn?: string }[]> {
    const rows = await this.#db.query<{
      app_id: string;
      store_id: string;
      observed_on: string | null;
    }>(
      "select app_id, store_id::text, observed_on::text from ground_truth order by app_id, store_id",
    );
    return rows.map((row) => ({
      appId: row.app_id,
      storeId: Number(row.store_id),
      ...(row.observed_on === null ? {} : { observedOn: row.observed_on }),
    }));
  }

  /** A canary that no longer answers teaches nothing and raises the same alert every night. */
  async removeCanary(storeUrl: string): Promise<boolean> {
    const rows = await this.#db.query<{ store_url: string }>(
      "delete from canaries where store_url = $1 returning store_url",
      [storeUrl],
    );
    return rows.length > 0;
  }

  /** How scans ended over a window, which is how a platform-wide block shows itself. */
  async statusShares(hours: number): Promise<StatusShare[]> {
    return this.#db.query<StatusShare>(
      `select status, count(distinct store_key)::int as stores
       from scans
       where scanned_at > now() - make_interval(hours => $1::int)
       group by status
       order by count(distinct store_key) desc`,
      [hours],
    );
  }

  /**
   * Stores each app was detected in, per window. A fingerprint that stops matching from
   * one week to the next is usually stale rather than uninstalled everywhere at once.
   */
  async appDetectionCounts(days: number, endingDaysAgo = 0): Promise<Map<string, number>> {
    const rows = await this.#db.query<{ app_id: string; stores: number }>(
      `select app->>'appId' as app_id, count(distinct store_key)::int as stores
       from scans, jsonb_array_elements(report->'apps') as app
       where status = 'live'
         and scanned_at > now() - make_interval(days => $1::int + $2::int)
         and scanned_at <= now() - make_interval(days => $2::int)
       group by app->>'appId'`,
      [days, endingDaysAgo],
    );
    return new Map(rows.map((row) => [row.app_id, row.stores]));
  }

  async recentHealthEvents(limit: number): Promise<HealthEventRow[]> {
    return this.#db.query<HealthEventRow>(
      `select id::text as id, kind, severity, detail, created_at as "createdAt"
       from health_events order by created_at desc limit $1`,
      [limit],
    );
  }

  async recordHealthEvent(event: HealthEvent): Promise<void> {
    await this.#db.query(
      "insert into health_events (kind, severity, detail) values ($1, $2, $3::text::jsonb)",
      [event.kind, event.severity, JSON.stringify(event.detail ?? {})],
    );
  }

  /** Records domain ownership without claiming the app's details were fetched. */
  async saveSeedDomains(pairs: readonly { appId: string; domain: string }[]): Promise<void> {
    if (pairs.length === 0) {
      return;
    }
    await this.#db.query(
      `update apps set developer_domains = incoming.domains, updated_at = now()
       from (
         select app_id, array_agg(distinct domain) as domains
         from jsonb_to_recordset($1::text::jsonb) as pairs(app_id text, domain text)
         group by app_id
       ) as incoming
       where apps.id = incoming.app_id and cardinality(apps.developer_domains) = 0`,
      [JSON.stringify(pairs.map((pair) => ({ app_id: pair.appId, domain: pair.domain })))],
    );
  }

  async appsPendingDetails(staleBefore: Date): Promise<number> {
    const rows = await this.#db.query<{ count: string }>(
      `select count(*)::text as count from apps
       where status <> 'unidentified' and (details_fetched_at is null or details_fetched_at < $1)`,
      [staleBefore],
    );
    return Number(rows[0]?.count ?? 0);
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

  async upsertThemes(themes: readonly ThemeUpsert[]): Promise<void> {
    if (themes.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into themes (id, name, developer, version, rating, ratings_count, is_beta, listing_id)
       select id, name, developer, version, rating, ratings_count, coalesce(is_beta, false), listing_id
       from jsonb_to_recordset($1::text::jsonb) as incoming(
         id text, name text, developer text, version text,
         rating real, ratings_count int, is_beta boolean, listing_id text
       )
       on conflict (id) do update set
         name = excluded.name,
         developer = coalesce(excluded.developer, themes.developer),
         version = coalesce(excluded.version, themes.version),
         rating = excluded.rating,
         ratings_count = excluded.ratings_count,
         is_beta = excluded.is_beta,
         listing_id = coalesce(excluded.listing_id, themes.listing_id),
         status = 'listed',
         updated_at = now()`,
      [
        JSON.stringify(
          themes.map((theme) => ({
            id: theme.id,
            name: theme.name,
            developer: theme.developer ?? null,
            version: theme.version ?? null,
            rating: theme.rating ?? null,
            ratings_count: theme.ratingsCount ?? null,
            is_beta: theme.isBeta ?? false,
            listing_id: theme.listingId ?? null,
          })),
        ),
      ],
    );
  }

  /** A theme that leaves the store keeps its row: stores still running it deserve a name. */
  async markThemesMissingFromCatalog(seenIds: readonly string[]): Promise<number> {
    const rows = await this.#db.query<{ id: string }>(
      `update themes set status = 'delisted', updated_at = now()
       where status = 'listed' and not (id = any($1::text[]))
       returning id`,
      [seenIds],
    );
    return rows.length;
  }

  async upsertFingerprints(fingerprints: readonly FingerprintUpsert[]): Promise<void> {
    if (fingerprints.length === 0) {
      return;
    }
    await this.#db.query(
      `insert into fingerprints (id, kind, pattern, strength, source, status, app_id, company, company_app_ids, min_product_share)
       select id, kind, pattern, strength, source, status, app_id, company,
              coalesce(company_app_ids, '{}'), min_product_share
       from jsonb_to_recordset($1::text::jsonb) as incoming(
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
       from jsonb_to_recordset($1::text::jsonb) as incoming(kind text, pattern text, reason text)
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
       from jsonb_to_recordset($1::text::jsonb) as incoming(app_id text, store_id bigint, observed_on date)
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

  /** When each scheduled job last finished, so a schedule that stopped can be noticed. */
  async jobRuns(): Promise<JobRun[]> {
    const rows = await this.#db.query<{
      job: string;
      last_run_at: Date | null;
      last_status: string | null;
      last_success_at: Date | null;
    }>("select job, last_run_at, last_status, last_success_at from job_state order by job");
    return rows.map((row) => ({
      job: row.job,
      ...(row.last_run_at === null ? {} : { lastRunAt: row.last_run_at }),
      ...(row.last_status === null ? {} : { lastStatus: row.last_status }),
      ...(row.last_success_at === null ? {} : { lastSuccessAt: row.last_success_at }),
    }));
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
      `insert into job_state (job, cursor, last_run_at, last_status, last_success_at, updated_at)
       values ($1, $2::text::jsonb, $3, $4, case when $4 = 'completed' then $3::timestamptz end, now())
       on conflict (job) do update set
         cursor = excluded.cursor,
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         -- A failure leaves the last success where it was: that is what says how stale
         -- the job's output has become.
         last_success_at = coalesce(excluded.last_success_at, job_state.last_success_at),
         updated_at = now()`,
      [job, JSON.stringify(cursor), ranAt, status],
    );
  }

  /**
   * Stores the assembled knowledge so readers do not have to rebuild it. Called after any
   * job that changes apps, fingerprints or noise.
   */
  async publishSnapshot(): Promise<KnowledgeSnapshot> {
    const snapshot = await this.loadSnapshot();
    await this.#db.query(
      `insert into knowledge_snapshots (version, document)
       values ($1, $2::text::jsonb)
       on conflict (version) do update set built_at = now()`,
      [snapshot.version, JSON.stringify(snapshot)],
    );
    await this.#db.query(
      `delete from knowledge_snapshots
       where version not in (
         select version from knowledge_snapshots order by built_at desc limit 3
       )`,
    );
    return snapshot;
  }

  /** The published knowledge, read in one row. Falls back to assembling it when absent. */
  async readPublishedSnapshot(): Promise<KnowledgeSnapshot | undefined> {
    const rows = await this.#db.query<{ document: KnowledgeSnapshot }>(
      "select document from knowledge_snapshots order by built_at desc limit 1",
    );
    return rows[0]?.document;
  }

  /** Assembles everything the engine needs for a scan, with a version derived from it. */
  async loadSnapshot(): Promise<KnowledgeSnapshot> {
    const [appRows, themeRows, fingerprintRows, noiseRows] = await Promise.all([
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
        name: string;
        developer: string | null;
        version: string | null;
        rating: number | null;
        ratings_count: number | null;
        is_beta: boolean;
        listing_id: string | null;
      }>(
        `select id, name, developer, version, rating, ratings_count, is_beta, listing_id
         from themes order by id`,
      ),
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

    const themes: Record<string, ThemeInfo> = {};
    for (const row of themeRows) {
      themes[row.id] = {
        id: row.id,
        name: row.name,
        ...(row.developer === null ? {} : { developer: row.developer }),
        ...(row.version === null ? {} : { version: row.version }),
        ...(row.rating === null ? {} : { rating: row.rating }),
        ...(row.ratings_count === null ? {} : { ratingsCount: row.ratings_count }),
        ...(row.is_beta ? { isBeta: true } : {}),
        ...(row.listing_id === null ? {} : { listingId: row.listing_id }),
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
      version: `db-${fnv1a(JSON.stringify([appRows, themeRows, fingerprintRows, noiseRows]))}`,
      apps,
      themes,
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
