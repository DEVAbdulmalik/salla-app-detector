import { KnowledgeRepository, type Database } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import { err, ok } from "@salla-app-detector/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncThemes, type ThemeClient } from "./theme-sync";

let database: Database;
let repository: KnowledgeRepository;

beforeEach(async () => {
  database = await createEmbeddedDatabase();
  await migrate(database);
  repository = new KnowledgeRepository(database);
});

afterEach(async () => {
  await database.close();
});

function client(themes: { id: string; name: string; version?: string }[]): ThemeClient {
  return { fetchThemes: () => Promise.resolve(ok(themes.map((t) => ({ ...t, listingId: "1" })))) };
}

describe("syncThemes", () => {
  it("stores what the theme catalogue publishes", async () => {
    const result = await syncThemes({
      repository,
      client: client([
        { id: "1298199463", name: "رائد", version: "1.377.0" },
        { id: "632105401", name: "سيليا" },
      ]),
    });

    const snapshot = await repository.loadSnapshot();
    expect(result).toEqual(ok({ themes: 2, delisted: 0 }));
    expect(snapshot.themes["1298199463"]).toMatchObject({ name: "رائد", version: "1.377.0" });
  });

  it("marks a theme the catalogue dropped but keeps its name", async () => {
    await syncThemes({
      repository,
      client: client([
        { id: "1", name: "باقٍ" },
        { id: "2", name: "مسحوب" },
      ]),
    });

    const result = await syncThemes({ repository, client: client([{ id: "1", name: "باقٍ" }]) });
    const snapshot = await repository.loadSnapshot();

    // Stores still running it would otherwise show a bare number.
    expect(result).toEqual(ok({ themes: 1, delisted: 1 }));
    expect(snapshot.themes["2"]?.name).toBe("مسحوب");
  });

  it("leaves the catalogue untouched when the theme store cannot be read", async () => {
    await syncThemes({ repository, client: client([{ id: "1", name: "رائد" }]) });

    const result = await syncThemes({
      repository,
      client: {
        fetchThemes: () =>
          Promise.resolve(err({ code: "http" as const, status: 503, endpoint: "themes" })),
      },
    });

    expect(result.ok).toBe(false);
    expect((await repository.loadSnapshot()).themes["1"]?.name).toBe("رائد");
    expect((await repository.jobState("theme-sync"))?.lastStatus).toBe("failed:http:503");
  });
});
