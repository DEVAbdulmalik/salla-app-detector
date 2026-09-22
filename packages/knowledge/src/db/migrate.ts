import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./executor";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "migrations");

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

/**
 * Applies pending migrations in order, each in its own transaction, and records what ran.
 * Running it twice is a no-op, so deploys and local setups use the same path.
 */
export async function migrate(
  database: Database,
  directory = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  await database.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const done = await database.query<{ version: string }>("select version from schema_migrations");
  const alreadyApplied = new Set(done.map((row) => row.version));

  const applied: string[] = [];
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const version = file.replace(/\.sql$/, "");
    if (alreadyApplied.has(version)) {
      continue;
    }
    const statements = readFileSync(join(directory, file), "utf8");
    try {
      await database.transaction(async (tx) => {
        await tx.query(statements);
        await tx.query("insert into schema_migrations (version) values ($1)", [version]);
      });
    } catch (error) {
      throw new Error(`migration ${version} failed`, { cause: error });
    }
    applied.push(version);
  }

  return { applied, alreadyApplied: [...alreadyApplied] };
}
