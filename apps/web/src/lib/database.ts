import { KnowledgeRepository, connect, type Database } from "@salla-app-detector/knowledge";

/**
 * One connection pool per server instance. Serverless invocations reuse a warm instance,
 * so creating a pool per request would exhaust the database's connection budget.
 */
let cached: { database: Database; repository: KnowledgeRepository } | undefined;

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  return url === undefined || url.trim() === "" ? undefined : url;
}

export function getRepository(): KnowledgeRepository | undefined {
  const url = databaseUrl();
  if (url === undefined) {
    return undefined;
  }
  cached ??= createPool(url);
  return cached.repository;
}

function createPool(url: string): { database: Database; repository: KnowledgeRepository } {
  const database = connect({ url, maxConnections: 2 });
  return { database, repository: new KnowledgeRepository(database) };
}
