#!/usr/bin/env -S npx tsx
/**
 * Seed loader: reads every /db/seed/usecases/*.json (produced by
 * usecase-content-agent's pipeline -- see /db/seed/README.md) and upserts
 * each one into the `use_cases` table via the Supabase service-role client.
 *
 * Usage:
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npm run db:load-seed-usecases -- [--dry-run]
 *
 * Behavior:
 *  - Idempotent / safe to re-run: upserts by `id` (ON CONFLICT (id) DO
 *    UPDATE), so re-running after a seed file is edited just updates that
 *    row -- never creates duplicates.
 *  - Fails fast and loudly if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 *    unset, same pattern as scripts/usecase-pipeline/generate-batch.ts's
 *    ANTHROPIC_API_KEY handling -- never silently no-ops.
 *  - Re-validates every record against /docs/schemas/use-case.schema.json
 *    (reusing scripts/usecase-pipeline/lib/schema-validate.ts, the same
 *    validator the content pipeline itself uses) before writing anything --
 *    a record that's invalid is reported and skipped, not written half-
 *    formed. This is a final sanity check on top of `npm run usecase:validate`
 *    (see /db/seed/README.md), not a replacement for it.
 *  - Uses the service-role key (bypasses RLS) because use_cases is
 *    shared/public content, not owned by any one user -- see
 *    /db/migrations/0002_use_cases.sql for the corresponding RLS policy
 *    (public read, no public write; writes only via service role).
 *  - --dry-run: validates and logs what would be upserted without writing.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { validateUseCase } from "./usecase-pipeline/lib/schema-validate.js";
import type { UseCase } from "./usecase-pipeline/lib/types.js";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const SEED_DIR = path.join(ROOT, "db/seed/usecases");

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. This script writes to a real Supabase project and will not ` +
        `silently no-op -- set ${name} in your environment before running it.`
    );
  }
  return value;
}

function loadSeedRecords(): { file: string; useCase: UseCase }[] {
  if (!fs.existsSync(SEED_DIR)) {
    throw new Error(`Seed directory not found: ${SEED_DIR}`);
  }
  const files = fs
    .readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  return files.map((file) => {
    const fullPath = path.join(SEED_DIR, file);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const useCase = JSON.parse(raw) as UseCase;
    return { file, useCase };
  });
}

function toRow(useCase: UseCase) {
  return {
    id: useCase.id,
    title: useCase.title,
    description: useCase.description ?? null,
    category: useCase.category,
    subcategory: useCase.subcategory,
    tags: useCase.tags ?? [],
    scenario_slots: useCase.scenario_slots,
    template_list: useCase.template_list,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const records = loadSeedRecords();
  console.log(`Found ${records.length} seed file(s) in ${path.relative(ROOT, SEED_DIR)}.`);

  const validRows: ReturnType<typeof toRow>[] = [];
  let invalidCount = 0;

  for (const { file, useCase } of records) {
    const result = validateUseCase(useCase);
    if (!result.valid) {
      invalidCount++;
      console.error(`INVALID ${file} (id=${result.id ?? "?"}):`);
      for (const err of [...result.schemaErrors, ...result.lintErrors]) {
        console.error(`  - ${err}`);
      }
      continue;
    }
    if (path.basename(file, ".json") !== useCase.id) {
      invalidCount++;
      console.error(`INVALID ${file}: filename does not match id "${useCase.id}"`);
      continue;
    }
    validRows.push(toRow(useCase));
  }

  if (invalidCount > 0) {
    console.error(`\n${invalidCount} record(s) failed validation and were skipped (not written).`);
  }

  if (validRows.length === 0) {
    console.log("Nothing valid to load.");
    if (invalidCount > 0) process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`--dry-run: would upsert ${validRows.length} use_cases row(s):`);
    for (const row of validRows) console.log(`  - ${row.id}`);
    if (invalidCount > 0) process.exitCode = 1;
    return;
  }

  const url = assertEnv("SUPABASE_URL");
  const serviceRoleKey = assertEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Upsert by id (the table's primary key) -- idempotent: re-running after
  // editing a seed file just updates that row, never duplicates it.
  const { error, count } = await supabase
    .from("use_cases")
    .upsert(validRows, { onConflict: "id", count: "exact" });

  if (error) {
    throw new Error(`Upsert failed: ${error.message}`);
  }

  console.log(`Upserted ${count ?? validRows.length} use_cases row(s).`);
  if (invalidCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
