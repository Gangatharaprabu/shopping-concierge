/**
 * Resumable state persistence for the batch-generation pipeline.
 *
 * generate-batch.ts reads this file at startup, generates only what's left
 * to reach each subcategory's target count, and re-writes it after every
 * single batch (not just at the end of a run) -- so a crashed, killed, or
 * rate-limited process can be re-run with the exact same command and it
 * will pick up where it left off instead of regenerating or duplicating
 * work. The file itself is plain JSON, committed to the repo, so progress
 * is visible in `git diff` / `git log` across runs, not just in memory.
 */

import fs from "node:fs";
import path from "node:path";

export interface BatchLogEntry {
  batch_id: string;
  timestamp: string;
  subcategory: string;
  model: string | null;
  requested_count: number;
  generated_count: number;
  valid_count: number;
  invalid_count: number;
  dedup_flagged_count: number;
  written_count: number;
  source: "llm" | "hand-authored";
  notes?: string;
}

export interface SubcategoryProgress {
  target: number;
  generated: number;
  status: "pending" | "in_progress" | "done";
}

export interface GenerationState {
  updated_at: string;
  subcategories: Record<string, SubcategoryProgress>;
  batches: BatchLogEntry[];
}

export function emptyState(): GenerationState {
  return { updated_at: new Date().toISOString(), subcategories: {}, batches: [] };
}

export function loadState(statePath: string): GenerationState {
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }
  const raw = fs.readFileSync(statePath, "utf-8");
  if (raw.trim().length === 0) return emptyState();
  return JSON.parse(raw) as GenerationState;
}

export function saveState(statePath: string, state: GenerationState): void {
  state.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function recordBatch(
  statePath: string,
  entry: BatchLogEntry,
  target: number
): GenerationState {
  const state = loadState(statePath);
  state.batches.push(entry);

  const existing = state.subcategories[entry.subcategory] ?? {
    target,
    generated: 0,
    status: "pending",
  };
  existing.target = target;
  existing.generated += entry.written_count;
  existing.status = existing.generated >= existing.target ? "done" : "in_progress";
  state.subcategories[entry.subcategory] = existing;

  saveState(statePath, state);
  return state;
}
