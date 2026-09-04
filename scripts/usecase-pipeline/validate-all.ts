#!/usr/bin/env -S npx tsx
/**
 * Validates every UseCase JSON file in /db/seed/usecases against
 * /docs/schemas/use-case.schema.json + the semantic lint rules in
 * lib/schema-validate.ts. Pure script validation, no LLM judgment involved.
 *
 * Usage:
 *   npm run usecase:validate
 *   npm run usecase:validate -- --dir path/to/other/dir
 *
 * Exits non-zero if any record fails schema or lint validation, so this is
 * safe to wire into CI later. Rejects and reports every failure -- never
 * silently drops a bad record.
 */

import fs from "node:fs";
import path from "node:path";
import { validateUseCase } from "./lib/schema-validate.js";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const DEFAULT_DIR = path.join(ROOT, "db/seed/usecases");

function parseArgs(argv: string[]): { dir: string } {
  let dir = DEFAULT_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i]);
  }
  return { dir };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.log(`No .json files found in ${dir}`);
    process.exit(0);
  }

  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      failCount++;
      failures.push(`${file}: invalid JSON -- ${(err as Error).message}`);
      continue;
    }

    const result = validateUseCase(data);
    if (result.valid) {
      passCount++;
      console.log(`PASS  ${file}  (id=${result.id})`);
    } else {
      failCount++;
      console.log(`FAIL  ${file}  (id=${result.id ?? "?"})`);
      for (const e of result.schemaErrors) console.log(`        schema: ${e}`);
      for (const e of result.lintErrors) console.log(`        lint:   ${e}`);
      failures.push(file);
    }
  }

  console.log("");
  console.log(`${passCount}/${files.length} passed, ${failCount} failed.`);

  if (failCount > 0) {
    console.log(`Failing files: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main();
