/**
 * Conservative price extraction from search-result snippet text.
 *
 * Per spec: "No result without an extractable price is returned" — so this
 * module is deliberately strict. It only matches text that pairs a number
 * with an unambiguous currency signal (a currency symbol or a 3-letter ISO
 * code immediately next to it). It never guesses that a bare number ("20",
 * "5kg", a model number, a percentage) is a price — those are dropped, not
 * defaulted to a currency.
 */

export interface ExtractedPrice {
  price: number;
  currency: string;
}

// Explicit ISO currency codes are checked first (unambiguous). Symbol-only
// matches are checked after, and default to the single most common currency
// for that symbol (documented limitation: "$" is assumed USD, not
// CAD/AUD/etc, unless an explicit code appears in the text).
// Two alternatives, comma-grouped form tried first: a plain `\d+` alone
// would still match a prefix of a comma-grouped number, but since
// alternation in JS regex accepts the first alternative that matches at
// all (it doesn't backtrack to find the longest overall match once the
// rest of the pattern is satisfied), the comma-requiring form MUST come
// first and MUST require at least one comma group — otherwise a number
// like "1,249.00" would risk matching only a prefix. The plain form
// (unlimited digits, no comma) handles everything else, e.g. "1500" or
// "12.99", so large un-grouped integers aren't truncated to 3 digits.
const NUMBER = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)";

const CODE_PATTERNS: Array<{ currency: string; regex: RegExp }> = [
  { currency: "USD", regex: new RegExp(`\\bUSD\\s?${NUMBER}`, "i") },
  { currency: "USD", regex: new RegExp(`${NUMBER}\\s?USD\\b`, "i") },
  { currency: "GBP", regex: new RegExp(`\\bGBP\\s?${NUMBER}`, "i") },
  { currency: "GBP", regex: new RegExp(`${NUMBER}\\s?GBP\\b`, "i") },
  { currency: "EUR", regex: new RegExp(`\\bEUR\\s?${NUMBER}`, "i") },
  { currency: "EUR", regex: new RegExp(`${NUMBER}\\s?EUR\\b`, "i") },
  { currency: "CAD", regex: new RegExp(`\\bCAD\\s?${NUMBER}`, "i") },
  { currency: "CAD", regex: new RegExp(`${NUMBER}\\s?CAD\\b`, "i") },
  { currency: "AUD", regex: new RegExp(`\\bAUD\\s?${NUMBER}`, "i") },
  { currency: "AUD", regex: new RegExp(`${NUMBER}\\s?AUD\\b`, "i") },
];

const SYMBOL_PATTERNS: Array<{ currency: string; regex: RegExp }> = [
  { currency: "GBP", regex: new RegExp(`£\\s?${NUMBER}`) },
  { currency: "EUR", regex: new RegExp(`€\\s?${NUMBER}`) },
  { currency: "USD", regex: new RegExp(`\\$\\s?${NUMBER}`) },
];

const MIN_SANE_PRICE = 0.01;
const MAX_SANE_PRICE = 100_000;

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_SANE_PRICE || value > MAX_SANE_PRICE) return null;
  return value;
}

/**
 * Returns the first confidently-extractable price found in `text`, or null
 * if nothing qualifies. Callers must drop the candidate entirely on null —
 * never fall back to a guessed price.
 */
export function extractPrice(text: string): ExtractedPrice | null {
  if (!text) return null;

  for (const { currency, regex } of CODE_PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      const price = parseNumber(match[1]);
      if (price !== null) return { price, currency };
    }
  }

  for (const { currency, regex } of SYMBOL_PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      const price = parseNumber(match[1]);
      if (price !== null) return { price, currency };
    }
  }

  return null;
}

const KNOWN_RETAILER_NAMES: Record<string, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  target: "Target",
  homedepot: "Home Depot",
  lowes: "Lowe's",
  ebay: "eBay",
  costco: "Costco",
  wayfair: "Wayfair",
  bestbuy: "Best Buy",
  acehardware: "Ace Hardware",
  instacart: "Instacart",
  kroger: "Kroger",
};

// Not an exhaustive public-suffix list (that's overkill for this
// prototype) — just the common two-label TLDs we're likely to see, so
// "shop.example.co.uk" resolves its brand label to "example", not "co".
const COMPOUND_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "co.nz",
  "co.in",
  "co.za",
  "com.au",
  "com.br",
]);

/** Registrable-domain brand label for a hostname, e.g. "shop.amazon.co.uk" -> "amazon". */
function brandLabelFromHostname(hostname: string): string | null {
  const labels = hostname.replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];

  const lastTwo = labels.slice(-2).join(".");
  const brandIndex = COMPOUND_TLDS.has(lastTwo) ? labels.length - 3 : labels.length - 2;
  return labels[brandIndex >= 0 ? brandIndex : 0];
}

/** Best-effort human-readable retailer name derived from a product URL's hostname. */
export function retailerFromUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  const brandLabel = brandLabelFromHostname(hostname);
  if (!brandLabel) return null;

  const known = KNOWN_RETAILER_NAMES[brandLabel.toLowerCase()];
  if (known) return known;

  return brandLabel.charAt(0).toUpperCase() + brandLabel.slice(1);
}

/** Registrable-domain key used to de-duplicate candidates from the same retailer. */
export function retailerKeyFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    const brandLabel = brandLabelFromHostname(hostname);
    return brandLabel ? brandLabel.toLowerCase() : null;
  } catch {
    return null;
  }
}
