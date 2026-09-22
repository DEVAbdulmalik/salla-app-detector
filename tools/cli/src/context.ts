import { existsSync } from "node:fs";
import { join } from "node:path";
import { compileKnowledge, type CompiledKnowledge } from "@salla-app-detector/engine";
import {
  KnowledgeRepository,
  connect,
  seedKnowledge,
  type Database,
} from "@salla-app-detector/knowledge";

const ENV_FILE = ".env.local";

/** Loads local settings the same way the deployed app receives them from the environment. */
export function loadEnvironment(): void {
  const file = join(process.cwd(), ENV_FILE);
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  return url === undefined || url.trim() === "" ? undefined : url;
}

export function openDatabase(): { database: Database; repository: KnowledgeRepository } {
  const url = databaseUrl();
  if (url === undefined) {
    throw new Error(`DATABASE_URL is not set. Add it to ${ENV_FILE} or the environment.`);
  }
  const database = connect({ url });
  return { database, repository: new KnowledgeRepository(database) };
}

export interface KnowledgeChoice {
  readonly knowledge: CompiledKnowledge;
  readonly source: "database" | "seed";
  close(): Promise<void>;
}

/**
 * Prefers the knowledge in the database, which is kept current by the sync job, and falls
 * back to the seed so the scanner still works before any database exists.
 */
export async function loadKnowledge(forceSeed: boolean): Promise<KnowledgeChoice> {
  if (forceSeed || databaseUrl() === undefined) {
    return {
      knowledge: compileKnowledge(seedKnowledge),
      source: "seed",
      close: () => Promise.resolve(),
    };
  }

  const { database, repository } = openDatabase();
  const snapshot = await repository.loadSnapshot();
  return {
    knowledge: compileKnowledge(snapshot),
    source: "database",
    close: () => database.close(),
  };
}
