/**
 * Integration test: every UseCase actually committed to /db/seed/usecases
 * must pass schema + lint validation, and the whole set must pass the
 * interim dedup heuristic (no near-duplicate titles). This is what
 * CLAUDE.md's "validate every batch against /docs/schemas/ before
 * committing" means in practice for this repo -- `npm test` re-checks the
 * committed seed data, not just the validator logic in isolation.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { validateUseCase } from "../lib/schema-validate.js";
import { findNearDuplicates, type DedupCandidate } from "../lib/dedup.js";

const SEED_DIR = path.resolve(new URL(".", import.meta.url).pathname, "../../../db/seed/usecases");

function loadSeedFiles(): { file: string; data: unknown }[] {
  if (!fs.existsSync(SEED_DIR)) return [];
  return fs
    .readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), "utf-8")) }));
}

describe("seed data in /db/seed/usecases", () => {
  const records = loadSeedFiles();

  it("has at least one seed record to validate", () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it.each(records.map((r) => [r.file, r.data] as const))("%s validates against schema + lint rules", (file, data) => {
    const result = validateUseCase(data);
    if (!result.valid) {
      throw new Error(
        `${file} failed validation:\n schemaErrors: ${JSON.stringify(result.schemaErrors, null, 2)}\n lintErrors: ${JSON.stringify(result.lintErrors, null, 2)}`
      );
    }
    expect(result.valid).toBe(true);
  });

  it("every file's basename matches its own id", () => {
    for (const { file, data } of records) {
      expect(file).toBe(`${(data as { id: string }).id}.json`);
    }
  });

  // Pairs that a human/agent has manually reviewed and confirmed are NOT
  // duplicates, despite tripping the lexical Jaccard heuristic on shared
  // short words (e.g. "weekend"/"trip"). Keep in sync with the
  // REVIEWED_FALSE_POSITIVES list in author-initial-batch.ts -- any new
  // flag not in this list should be treated as a real dedup hit to
  // investigate, not silently added here.
  const REVIEWED_FALSE_POSITIVES = new Set<string>([
    "weekend-trip-getaway|girls-weekend-trip",
    "weekend-trip-getaway|weekend-ski-trip",
  ]);

  it("has no near-duplicate titles per the interim dedup heuristic (beyond reviewed false positives)", () => {
    const candidates: DedupCandidate[] = records.map(({ data }) => ({
      id: (data as { id: string; title: string }).id,
      title: (data as { id: string; title: string }).title,
    }));
    const flags = findNearDuplicates(candidates).filter((f) => {
      const key1 = `${f.a.id}|${f.b.id}`;
      const key2 = `${f.b.id}|${f.a.id}`;
      return !REVIEWED_FALSE_POSITIVES.has(key1) && !REVIEWED_FALSE_POSITIVES.has(key2);
    });
    if (flags.length > 0) {
      const summary = flags.map((f) => `"${f.a.title}" (${f.a.id}) ~ "${f.b.title}" (${f.b.id}) sim=${f.similarity.toFixed(2)}`);
      throw new Error(`Near-duplicate titles found:\n${summary.join("\n")}`);
    }
    expect(flags.length).toBe(0);
  });
});
