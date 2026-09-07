/**
 * Interim dedup check for generated UseCase records.
 *
 * IMPORTANT / TODO: this is a placeholder for real embedding-based dedup.
 * CLAUDE.md and /docs/schemas/README.md both assume pgvector-backed
 * embedding similarity search for use-case dedup, but as of this pipeline
 * (usecase-content-agent, Phase 2) there is no database, no pgvector
 * extension, and no embeddings API wired up yet -- that infra is
 * backend-agent/feed-agent's job in a later phase. Rather than block on
 * that, this module does a cheap, dependency-free, *lexical* near-duplicate
 * check on titles: normalize (lowercase, strip punctuation, drop stopwords)
 * and compare token sets with Jaccard similarity. It will catch obvious
 * near-dupes ("Backyard BBQ Cookout" vs "Backyard BBQ Cook-out for Friends")
 * but will NOT catch semantic duplicates that are lexically distant (e.g.
 * "Cookout with the Grill" vs "Backyard Barbecue Party" would likely score
 * low here despite being near-identical use cases). When real embeddings
 * exist, replace `findNearDuplicates` with a pgvector cosine-similarity
 * query and delete this heuristic -- do not extend it into a bigger NLP
 * project in the meantime.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "for", "of", "and", "or", "with", "to", "on", "in", "at",
  "your", "it", "this", "that", "your's",
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((tok) => tok.length > 0 && !STOPWORDS.has(tok))
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DedupCandidate {
  id: string;
  title: string;
}

export interface DedupFlag {
  a: DedupCandidate;
  b: DedupCandidate;
  similarity: number;
  exactNormalizedMatch: boolean;
}

/** Default flag threshold: >= 0.6 Jaccard similarity on normalized title tokens. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/**
 * Compares every pair of candidates (O(n^2) -- fine at hundreds of records,
 * would need real embeddings + an ANN index well before 1000+ records
 * across every subcategory) and flags pairs at or above `threshold`, or
 * with an identical normalized title, for manual review. Does not auto-drop
 * anything -- per the task brief, flagged pairs are surfaced, not silently
 * removed.
 */
export function findNearDuplicates(
  candidates: DedupCandidate[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): DedupFlag[] {
  const flags: DedupFlag[] = [];
  const normalized = candidates.map((c) => ({
    c,
    norm: normalizeTitle(c.title),
    tokens: titleTokens(c.title),
  }));

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const A = normalized[i];
      const B = normalized[j];
      if (A.c.id === B.c.id) continue;
      const exactNormalizedMatch = A.norm === B.norm && A.norm.length > 0;
      const similarity = jaccardSimilarity(A.tokens, B.tokens);
      if (exactNormalizedMatch || similarity >= threshold) {
        flags.push({ a: A.c, b: B.c, similarity, exactNormalizedMatch });
      }
    }
  }

  return flags.sort((x, y) => y.similarity - x.similarity);
}
