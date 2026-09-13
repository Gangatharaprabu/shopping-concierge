/**
 * Shared, presentation-only design-system helpers for the Figma-Make-derived
 * visual language (see the redesign task brief and app/globals.css's
 * matching CSS custom properties). Nothing here is business logic or
 * persisted data -- nothing in /docs/schemas or /lib/types.ts changes to
 * support this file; nothing here is stored, only computed at render time.
 */

/** One entry of the 5-color pastel card-background palette, cycled by index. */
export interface CardPalette {
  bg: string;
  border: string;
  text: string;
  sub: string;
}

/** Mirrors app/globals.css's --pal-N-* custom properties -- keep both in sync if either changes. */
export const PALETTES: CardPalette[] = [
  { bg: "#FFFFFF", border: "#EBEBEB", text: "#0D0D0D", sub: "#999999" },
  { bg: "#FFFBEA", border: "#F0E68C", text: "#3D2800", sub: "#9B7A20" },
  { bg: "#F0FFF4", border: "#BBF0CC", text: "#0D3320", sub: "#2E7D52" },
  { bg: "#FFF0F5", border: "#F5C6D8", text: "#3D0820", sub: "#8B3055" },
  { bg: "#F0F4FF", border: "#C6D4F5", text: "#0D1A3D", sub: "#3055A0" },
];

/** Picks a palette entry by cycling `PALETTES` -- the same "pal(i)" helper the Figma reference uses for its cards. */
export function pal(index: number): CardPalette {
  return PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length];
}

/**
 * Purely cosmetic, client-derived emoji guess for a shopping-list item name --
 * ports the Figma reference's `guessEmoji()` idea. No schema change, no
 * stored emoji field: this is recomputed from `item.name` at render time
 * every time, same as the reference implementation.
 */
export function guessEmoji(name: string): string {
  const t = name.toLowerCase();
  if (/water|drink|beverage|soda|juice/.test(t)) return "\u{1F4A7}"; // 💧
  if (/beer|wine|cider|champagne/.test(t)) return "\u{1F37A}"; // 🍺
  if (/coffee|tea\b/.test(t)) return "☕"; // ☕
  if (/meat|beef|burger|steak|patt/.test(t)) return "\u{1F354}"; // 🍔
  if (/chicken|turkey/.test(t)) return "\u{1F357}"; // 🍗
  if (/hot dog/.test(t)) return "\u{1F32D}"; // 🌭
  if (/fish|seafood|shrimp/.test(t)) return "\u{1F41F}"; // 🐟
  if (/fruit|melon|watermelon|apple|berry/.test(t)) return "\u{1F349}"; // 🍉
  if (/veg|salad|corn|potato/.test(t)) return "\u{1F966}"; // 🥦
  if (/bread|bun|roll|bagel/.test(t)) return "\u{1F35E}"; // 🍞
  if (/cake|pie|dessert|cookie/.test(t)) return "\u{1F370}"; // 🍰
  if (/food|eat|meal|snack/.test(t)) return "\u{1F37D}️"; // 🍽️
  if (/plate|napkin|cup|cutlery|fork|tableware/.test(t)) return "\u{1F37D}️"; // 🍽️
  if (/grill|charcoal|bbq|fire/.test(t)) return "\u{1F525}"; // 🔥
  if (/ice\b|cooler/.test(t)) return "\u{1F9CA}"; // 🧊
  if (/medic|pill|first aid|thermometer/.test(t)) return "\u{1F48A}"; // 💊
  if (/cloth|shirt|jacket|onesie|swimsuit/.test(t)) return "\u{1F455}"; // 👕
  if (/shoe|flip flop|sandal|boot/.test(t)) return "\u{1F45F}"; // 👟
  if (/sock/.test(t)) return "\u{1F9E6}"; // 🧦
  if (/phone|charger|cable/.test(t)) return "\u{1F4F1}"; // 📱
  if (/laptop|computer|monitor|keyboard|mouse/.test(t)) return "\u{1F4BB}"; // 💻
  if (/camera/.test(t)) return "\u{1F4F7}"; // 📷
  if (/headphone|earbud|speaker/.test(t)) return "\u{1F3A7}"; // 🎧
  if (/bag|backpack|luggage|suitcase/.test(t)) return "\u{1F9F3}"; // 🧳
  if (/book|notebook|journal/.test(t)) return "\u{1F4DA}"; // 📚
  if (/pen|pencil/.test(t)) return "✏️"; // ✏️
  if (/sun|spf|sunscreen/.test(t)) return "\u{1F9F4}"; // 🧴
  if (/tent|camp/.test(t)) return "⛺"; // ⛺
  if (/sleep|blanket|pillow/.test(t)) return "\u{1F6CF}️"; // 🛏️
  if (/flashlight|headlamp|lamp|light/.test(t)) return "\u{1F526}"; // 🔦
  if (/baby|diaper|crib|stroller/.test(t)) return "\u{1F476}"; // 👶
  if (/dog|pet|leash/.test(t)) return "\u{1F436}"; // 🐶
  if (/chair|desk|furniture/.test(t)) return "\u{1FA91}"; // 🪑
  if (/plant|garden/.test(t)) return "\u{1F331}"; // 🌱
  if (/candle|decor|ornament/.test(t)) return "\u{1F56F}️"; // 🕯️
  if (/gift|present/.test(t)) return "\u{1F381}"; // 🎁
  if (/trash|clean|soap|sponge/.test(t)) return "\u{1F9FC}"; // 🧼
  return "\u{1F4E6}"; // 📦
}

/** Fallback emoji per top-level category, used for a use case's header icon when no better guess applies. */
const CATEGORY_EMOJI: Record<string, string> = {
  events: "\u{1F389}", // 🎉
  travel: "✈️", // ✈️
  home: "\u{1F3E0}", // 🏠
  seasonal: "\u{1F342}", // 🍂
};

/**
 * Best-effort emoji for a UseCase's header: tries the same keyword guess as
 * item names against the title first (titles are often concrete enough,
 * e.g. "Backyard BBQ Cookout" -> 🔥), falling back to a flat per-category
 * icon. Still purely cosmetic/client-derived -- see file header.
 */
export function guessUseCaseEmoji(title: string, category: string): string {
  const guess = guessEmoji(title);
  return guess === "\u{1F4E6}" ? (CATEGORY_EMOJI[category] ?? "\u{1F4E6}") : guess;
}
