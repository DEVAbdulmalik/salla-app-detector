import postgres, { type Sql, type TransactionSql } from "postgres";
import type { Database } from "./executor";

export interface ConnectOptions {
  readonly url: string;
  /** Serverless invocations are short-lived, so a small pool is enough. */
  readonly maxConnections?: number;
  readonly connectTimeoutSeconds?: number;
}

export function connect(options: ConnectOptions): Database {
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 3,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    idle_timeout: 20,
    // Supabase's pooler runs in transaction mode, which cannot reuse prepared statements.
    prepare: false,
    onnotice: () => undefined,
  });

  return wrap(sql, () => sql.end({ timeout: 5 }));
}

function wrap(sql: Sql, close: () => Promise<void>): Database {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as Row[];
    },
    transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
      return sql.begin((tx: TransactionSql) =>
        work(wrap(tx as unknown as Sql, () => Promise.resolve())),
      ) as Promise<T>;
    },
    close,
  };
}
