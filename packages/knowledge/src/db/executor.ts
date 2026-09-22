/**
 * The narrow database surface the repositories use. Production runs against Supabase over
 * postgres.js; tests run the same SQL against an embedded Postgres, so queries are checked
 * for real rather than against a mock.
 */
export interface Database {
  query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
  /**
   * Runs `work` inside a transaction that commits on success and rolls back on failure.
   * It is a method rather than raw `begin`/`commit` statements because a pooled connection
   * cannot guarantee that those land on the same session.
   */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
