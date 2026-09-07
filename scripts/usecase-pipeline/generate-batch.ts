#!/usr/bin/env -S npx tsx
/**
 * Resumable batch-generation CLI for UseCase seed data.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npm run usecase:generate -- \
 *     [--subcategory events.bbq_grilling] [--batch-size 8] [--model claude-...] \
 *     [--max-batches 5] [--dry-run]
 *
 * Behavior:
 *  - Reads batch-plan.json for the target count per subcategory (default:
 *    every subcategory in /docs/schemas/category-taxonomy.json, 20 each --
 *    ~1040 total, matching CLAUDE.md's "1000+ use cases").
 *  - Reads state/generation-state.json to see how many use cases already
 *    exist per subcategory (seeded from both prior pipeline runs AND any
 *    hand-authored records already sitting in /db/seed/usecases -- the
 *    state file is reconciled against the actual files on disk at startup,
 *    so it can never drift into over- or under-counting).
 *  - For each subcategory still below target (or just the one passed via
 *    --subcategory), asks Claude for one batch (--batch-size, default 8)
 *    of new UseCase records at a time -- NEVER the whole 1000+ in one call
 *    or one process lifetime. Existing titles in that subcategory are
 *    included in the prompt so the model doesn't repeat itself.
 *  - Every batch is validated (schema-validate.ts) and dedup-checked
 *    (dedup.ts) against everything already on disk before anything is
 *    written. Invalid or flagged-duplicate records are rejected and logged,
 *    never silently dropped or silently written.
 *  - State is persisted after EVERY batch (see lib/state.ts), so killing
 *    this process and re-running the same command resumes cleanly.
 *
 * This script requires a real ANTHROPIC_API_KEY and network access to the
 * Anthropic API. It intentionally fails fast and loudly if the key is
 * missing rather than silently doing nothing (see assertApiKey below).
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { validateUseCase } from "./lib/schema-validate.js";
import { findNearDuplicates, type DedupCandidate } from "./lib/dedup.js";
import { loadState, recordBatch, type GenerationState } from "./lib/state.js";
import { Logger } from "./lib/logger.js";
import type { UseCase } from "./lib/types.js";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const SEED_DIR = path.join(ROOT, "db/seed/usecases");
const STATE_FILE = path.join(ROOT, "scripts/usecase-pipeline/state/generation-state.json");
const BATCH_PLAN_FILE = path.join(ROOT, "scripts/usecase-pipeline/batch-plan.json");
const LOG_FILE = path.join(ROOT, "scripts/usecase-pipeline/logs/pipeline.log");
const TAXONOMY_FILE = path.join(ROOT, "docs/schemas/category-taxonomy.json");
const README_FILE = path.join(ROOT, "docs/schemas/README.md");

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_MODEL = "claude-sonnet-4-5";

interface CliArgs {
  subcategory?: string;
  batchSize: number;
  model: string;
  maxBatches: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    batchSize: DEFAULT_BATCH_SIZE,
    model: DEFAULT_MODEL,
    maxBatches: Infinity,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--subcategory":
        args.subcategory = argv[++i];
        break;
      case "--batch-size":
        args.batchSize = parseInt(argv[++i], 10);
        break;
      case "--model":
        args.model = argv[++i];
        break;
      case "--max-batches":
        args.maxBatches = parseInt(argv[++i], 10);
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/** Fails fast and loudly if ANTHROPIC_API_KEY is unset, per the pipeline's environment contract. */
function assertApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. This script calls the real Anthropic API and " +
        "will not silently no-op -- set ANTHROPIC_API_KEY in your environment before running " +
        "`npm run usecase:generate`. See scripts/usecase-pipeline/README.md."
    );
  }
  return key;
}

function loadExistingUseCases(): UseCase[] {
  if (!fs.existsSync(SEED_DIR)) return [];
  const files = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(SEED_DIR, f), "utf-8")) as UseCase);
}

/** Reconciles subcategory progress counts against the actual files on disk, so state can never drift. */
function reconcileState(state: GenerationState, existing: UseCase[]): GenerationState {
  const counts: Record<string, number> = {};
  for (const uc of existing) {
    counts[uc.subcategory] = (counts[uc.subcategory] ?? 0) + 1;
  }
  for (const [subcategory, count] of Object.entries(counts)) {
    const entry = state.subcategories[subcategory];
    if (!entry || entry.generated < count) {
      state.subcategories[subcategory] = {
        target: entry?.target ?? 20,
        generated: count,
        status: entry?.target != null && count >= entry.target ? "done" : "in_progress",
      };
    }
  }
  return state;
}

function buildPrompt(subcategoryId: string, subcategoryLabel: string, exampleTitles: string[], existingTitles: string[], count: number, schemaText: string, readmeExcerpt: string): string {
  return `You are generating seed content for a shopping-concierge app's UseCase library.

Generate exactly ${count} NEW, DISTINCT UseCase JSON records for subcategory "${subcategoryId}" (${subcategoryLabel}).

Requirements:
- Output ONLY a JSON array of ${count} UseCase objects, no prose, no markdown fences.
- Every record MUST validate against this JSON Schema (draft 2020-12):
${schemaText}
- Follow the patchability design described here (depends_on_slots, presence_rules, scaling_rules):
${readmeExcerpt}
- Use realistic, varied scaling_rules (linear and step) and presence_rules (dietary-gated, setting-gated, budget-gated) where appropriate -- do not make every item static.
- Each use case's template_list must reflect what THAT SPECIFIC scenario actually needs -- no copy-pasted generic lists across records.
- category must be the namespace prefix of subcategory (e.g. subcategory "events.bbq_grilling" implies category "events").
- id must be a unique kebab-case slug not already in this list of existing ids/titles in this subcategory: ${existingTitles.join("; ") || "(none yet)"}.
- Titles must be genuinely distinct from each other and from the existing titles above (no near-duplicates/rewordings).
- Example seed titles already used elsewhere for this subcategory for tone/scope reference only (do not repeat them): ${exampleTitles.join("; ")}.
`;
}

async function generateBatch(
  client: Anthropic,
  model: string,
  subcategoryId: string,
  subcategoryLabel: string,
  exampleTitles: string[],
  existingTitles: string[],
  count: number
): Promise<unknown[]> {
  const schemaText = fs.readFileSync(path.join(ROOT, "docs/schemas/use-case.schema.json"), "utf-8");
  const readmeExcerpt = fs.readFileSync(README_FILE, "utf-8").slice(0, 6000);
  const prompt = buildPrompt(subcategoryId, subcategoryLabel, exampleTitles, existingTitles, count, schemaText, readmeExcerpt);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const jsonText = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON array of UseCase records");
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = new Logger(LOG_FILE);

  const apiKey = assertApiKey();
  const client = new Anthropic({ apiKey });

  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_FILE, "utf-8"));
  const plan = JSON.parse(fs.readFileSync(BATCH_PLAN_FILE, "utf-8")) as {
    target_per_subcategory: number;
    subcategories: Record<string, number>;
  };

  const subcategoriesToRun = args.subcategory ? [args.subcategory] : Object.keys(plan.subcategories);

  fs.mkdirSync(SEED_DIR, { recursive: true });
  let existing = loadExistingUseCases();
  let state = reconcileState(loadState(STATE_FILE), existing);

  let batchesRun = 0;

  for (const subcategoryId of subcategoriesToRun) {
    if (batchesRun >= args.maxBatches) break;

    const target = plan.subcategories[subcategoryId] ?? plan.target_per_subcategory;
    const progress = state.subcategories[subcategoryId] ?? { target, generated: 0, status: "pending" };

    if (progress.generated >= target) {
      logger.log(`SKIP ${subcategoryId}: already at target (${progress.generated}/${target})`);
      continue;
    }

    const remaining = target - progress.generated;
    const count = Math.min(args.batchSize, remaining);

    const [categoryId] = subcategoryId.split(".");
    const catEntry = taxonomy["x-tree"].categories.find((c: { id: string }) => c.id === categoryId);
    const subEntry = catEntry?.subcategories.find((s: { id: string }) => s.id === subcategoryId);
    const subcategoryLabel = subEntry?.label ?? subcategoryId;
    const exampleTitles: string[] = subEntry?.example_use_cases ?? [];

    const existingInSub = existing.filter((uc) => uc.subcategory === subcategoryId);
    const existingTitles = existingInSub.map((uc) => uc.title);

    logger.log(`BATCH START subcategory=${subcategoryId} requesting=${count} (progress ${progress.generated}/${target})`);

    if (args.dryRun) {
      logger.log(`DRY RUN: would call model=${args.model} for ${count} records in ${subcategoryId}`);
      batchesRun++;
      continue;
    }

    let raw: unknown[];
    try {
      raw = await generateBatch(client, args.model, subcategoryId, subcategoryLabel, exampleTitles, existingTitles, count);
    } catch (err) {
      logger.error(`BATCH FAILED subcategory=${subcategoryId}: ${(err as Error).message}`);
      // Do not advance state on failure -- next run retries this subcategory.
      batchesRun++;
      continue;
    }

    let validCount = 0;
    let invalidCount = 0;
    const validRecords: UseCase[] = [];
    for (const record of raw) {
      const result = validateUseCase(record);
      if (result.valid) {
        validCount++;
        validRecords.push(record as UseCase);
      } else {
        invalidCount++;
        logger.warn(
          `REJECTED id=${result.id ?? "(unknown)"} schemaErrors=${JSON.stringify(result.schemaErrors)} lintErrors=${JSON.stringify(result.lintErrors)}`
        );
      }
    }

    const candidatePool: DedupCandidate[] = [
      ...existing.map((uc) => ({ id: uc.id, title: uc.title })),
      ...validRecords.map((uc) => ({ id: uc.id, title: uc.title })),
    ];
    const flags = findNearDuplicates(candidatePool);
    const flaggedIds = new Set<string>();
    for (const flag of flags) {
      // Only care about flags that involve a record from *this* batch.
      const newIds = new Set(validRecords.map((r) => r.id));
      if (newIds.has(flag.a.id) || newIds.has(flag.b.id)) {
        flaggedIds.add(newIds.has(flag.a.id) ? flag.a.id : flag.b.id);
        logger.warn(
          `DEDUP FLAG "${flag.a.title}" (${flag.a.id}) ~ "${flag.b.title}" (${flag.b.id}) similarity=${flag.similarity.toFixed(2)} exactMatch=${flag.exactNormalizedMatch}`
        );
      }
    }

    const toWrite = validRecords.filter((r) => !flaggedIds.has(r.id));
    for (const record of toWrite) {
      const filePath = path.join(SEED_DIR, `${record.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n", "utf-8");
    }

    logger.log(
      `BATCH DONE subcategory=${subcategoryId} generated=${raw.length} valid=${validCount} invalid=${invalidCount} dedupFlagged=${flaggedIds.size} written=${toWrite.length}`
    );

    state = recordBatch(
      STATE_FILE,
      {
        batch_id: `${subcategoryId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        subcategory: subcategoryId,
        model: args.model,
        requested_count: count,
        generated_count: raw.length,
        valid_count: validCount,
        invalid_count: invalidCount,
        dedup_flagged_count: flaggedIds.size,
        written_count: toWrite.length,
        source: "llm",
      },
      target
    );

    existing = existing.concat(toWrite);
    batchesRun++;
  }

  logger.log(`RUN COMPLETE: ${batchesRun} batch(es) processed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
