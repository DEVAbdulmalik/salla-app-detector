import { PGlite } from "@electric-sql/pglite";
import type { Database } from "./executor";

/**
 * An embedded Postgres for tests. The migrations and queries that run against Supabase run
 * here unchanged, so the SQL is exercised for real without needing a server or Docker.
 */
export async function createEmbeddedDatabase(): Promise<Database> {
  const pglite = await PGlite.create();

  const database: Database = {
    async query<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
      if (params.length === 0) {
        // Migration files hold several statements, which only the script runner accepts.
        const results = await pglite.exec(sql);
        return (results.at(-1)?.rows ?? []) as Row[];
      }
      const result = await pglite.query<Row>(sql, [...params]);
      return result.rows;
    },
    async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
      await pglite.exec("begin");
      try {
        const result = await work(database);
        await pglite.exec("commit");
        return result;
      } catch (error) {
        await pglite.exec("rollback");
        throw error;
      }
    },
    async close(): Promise<void> {
      await pglite.close();
    },
  };

  return database;
}
