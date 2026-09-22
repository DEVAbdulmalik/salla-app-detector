/**
 * The narrow database surface the repositories use. Production runs against Supabase over
 * postgres.js; tests run the same SQL against an embedded Postgres, so queries are checked
 * for real rather than against a mock.
 */
export interface Database {
  query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}
