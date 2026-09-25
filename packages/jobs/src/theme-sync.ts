import type { KnowledgeRepository } from "@salla-app-detector/knowledge";
import type { ApiFailure, CatalogTheme } from "@salla-app-detector/salla";
import { failureStatus } from "./failure";
import { err, ok, type Logger, type Result } from "@salla-app-detector/shared";

export interface ThemeClient {
  fetchThemes(): Promise<Result<CatalogTheme[], ApiFailure>>;
}

export interface ThemeSyncOptions {
  readonly client: ThemeClient;
  readonly repository: KnowledgeRepository;
  readonly logger?: Logger;
}

export interface ThemeSyncResult {
  readonly themes: number;
  readonly delisted: number;
}

const JOB = "theme-sync";

/**
 * Refreshes what the theme store publishes. Stores declare their theme by identifier, so
 * this table is the whole of the feature: without it a report has a number where a name
 * belongs. A theme that leaves the store is marked, never deleted, because the stores
 * running it still deserve its name.
 */
export async function syncThemes(
  options: ThemeSyncOptions,
): Promise<Result<ThemeSyncResult, ApiFailure>> {
  const startedAt = new Date();
  const catalog = await options.client.fetchThemes();

  if (!catalog.ok) {
    await options.repository.saveJobState(JOB, {}, failureStatus(catalog.error), startedAt);
    options.logger?.error("theme catalogue unavailable", { reason: catalog.error.code });
    return err(catalog.error);
  }

  await options.repository.upsertThemes(catalog.value);
  const delisted = await options.repository.markThemesMissingFromCatalog(
    catalog.value.map((theme) => theme.id),
  );

  await options.repository.saveJobState(JOB, {}, "completed", startedAt);
  options.logger?.info("themes synced", { themes: catalog.value.length, delisted });

  return ok({ themes: catalog.value.length, delisted });
}
