#!/usr/bin/env -S npx tsx
/**
 * Runs the interim lexical dedup heuristic (lib/dedup.ts) across every
 * UseCase in /db/seed/usecases and reports flagged near-duplicate pairs for
 * manual review. See lib/dedup.ts for why this is lexical (title-token
 * Jaccard similarity), not embedding-based -- that's a documented
 * placeholder until pgvector/embeddings infra exists (backend-agent /
 * feed-agent, later phase).
 *
 * Usage:
 *   npm run usecase:dedup
 *   npm run usecase:dedup -- --dir path/to/other/dir --threshold 0.5 --strict
 *
 * By default this only reports (exit 0) -- pass --strict to exit non-zero
 * when any pair is flagged, e.g. for a CI gate once the heuristic is judged
 * reliable enough.
 */

import fs from "node:fs";
import path from "node:path";
import { findNearDuplicates, DEFAULT_SIMILARITY_THRESHOLD, type DedupCandidate } from "./lib/dedup.js";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const DEFAULT_DIR = path.join(ROOT, "db/seed/usecases");

function parseArgs(argv: string[]): { dir: string; threshold: number; strict: boolean } {
  let dir = DEFAULT_DIR;
  let threshold = DEFAULT_SIMILARITY_THRESHOLD;
  let strict = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i]);
    else if (argv[i] === "--threshold") threshold = parseFloat(argv[++i]);
    else if (argv[i] === "--strict") strict = true;
  }
  return { dir, threshold, strict };
}

function main() {
  const { dir, threshold, strict } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const candidates: DedupCandidate[] = files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    return { id: data.id ?? f, title: data.title ?? "" };
  });

  console.log(`Checking ${candidates.length} use cases for near-duplicate titles (threshold=${threshold})...`);
  const flags = findNearDuplicates(candidates, threshold);

  if (flags.length === 0) {
    console.log("No near-duplicates flagged.");
    return;
  }

  console.log(`\n${flags.length} pair(s) flagged for manual review:\n`);
  for (const flag of flags) {
    console.log(
      `  "${flag.a.title}" (${flag.a.id})\n  ~ "${flag.b.title}" (${flag.b.id})\n    similarity=${flag.similarity.toFixed(2)} exactNormalizedMatch=${flag.exactNormalizedMatch}\n`
    );
  }

  if (strict) {
    process.exit(1);
  }
}

main();
