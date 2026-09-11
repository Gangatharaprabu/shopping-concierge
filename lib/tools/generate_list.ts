/**
 * generate_list tool
 *
 * Contract: /docs/tool-specs/generate_list.md (read that first -- this file
 * implements it, doesn't redefine it).
 *
 * Pure function, no I/O: given a UseCase (its `scenario_slots` definitions
 * and `template_list`, per /docs/schemas/use-case.schema.json) and a
 * Scenario's resolved `slots{}`, evaluates every `template_list_item` --
 * presence_rules gate whether it's included, scaling_rules (or qty.base if
 * none) determine how much -- and produces the resulting `ListItem[]`.
 *
 * This module also exports the underlying per-item evaluator
 * (`evaluateTemplateItem`) and slot-resolution helper (`resolveScenarioSlots`)
 * specifically so `adjust_scenario.ts` can reuse the exact same rule logic
 * for its patch-recompute step instead of re-implementing (or drifting from)
 * it -- see CLAUDE.md locked decision #2 and /docs/tool-specs/adjust_scenario.md.
 */

import type { ListItem } from "../types";

// ---------------------------------------------------------------------------
// Types -- mirror /docs/schemas/use-case.schema.json's $defs (scenario_slots,
// template_list_item, presence_rule, scaling_rule, duration_value). Declared
// locally, same "hand-kept mirror" approach as lib/types.ts and
// search_usecases.ts's UseCaseForSearch -- this module only needs the subset
// relevant to list generation, not the full authoring/validation shape.
// ---------------------------------------------------------------------------

export interface DurationValue {
  unit: "event" | "days";
  count: number;
}

/** The value shape stored for one slot on a live Scenario -- see schema's `slot_value`. */
export type SlotValue = string | number | string[] | DurationValue;

/** The subset of `slot_definition` this module needs: just enough to read `default`. */
export interface SlotDefinitionForList {
  type: "enum" | "integer" | "tag_list" | "duration" | string;
  default: SlotValue;
  options?: string[];
  min?: number;
  max?: number;
}

export interface PresenceRule {
  slot_id: string;
  condition: "equals" | "not_equals" | "includes" | "excludes";
  value: string;
}

export interface ScalingRuleLinear {
  slot_id: string;
  method: "linear";
  per_unit: number;
  round?: "up" | "down" | "nearest";
  minimum?: number;
}

export interface ScalingRuleStepTier {
  /** Inclusive upper bound for this tier; null = applies above the previous tier's up_to (must be last). */
  up_to: number | null;
  qty: number;
}

export interface ScalingRuleStep {
  slot_id: string;
  method: "step";
  tiers: ScalingRuleStepTier[];
}

export type ScalingRule = ScalingRuleLinear | ScalingRuleStep;

export interface TemplateListItem {
  item_id: string;
  name: string;
  category: string;
  qty: { base: number; unit: string };
  depends_on_slots: string[];
  presence_rules?: PresenceRule[];
  scaling_rules?: ScalingRule[];
  notes?: string;
}

/**
 * The subset of UseCase this module needs: `scenario_slots` (for default
 * resolution) and `template_list` (the items to evaluate). `id` is kept only
 * for error messages.
 */
export interface UseCaseForList {
  id: string;
  scenario_slots: Record<string, SlotDefinitionForList>;
  template_list: TemplateListItem[];
}

// ---------------------------------------------------------------------------
// Slot resolution
// ---------------------------------------------------------------------------

/**
 * Merges a (possibly partial) Scenario.slots map with each slot's own
 * `default` from the UseCase's `scenario_slots` definitions, producing a
 * fully-resolved slot value map -- "using each slot's default for anything
 * not explicitly set" (per this tool's brief). Any key present in
 * `providedSlots` but not declared in `useCase.scenario_slots` is passed
 * through as-is (defensive -- shouldn't normally happen for a well-formed
 * UseCase/Scenario pair, but dropping unknown data silently would be worse).
 */
export function resolveScenarioSlots(
  useCase: UseCaseForList,
  providedSlots: Record<string, unknown> = {},
): Record<string, SlotValue> {
  const resolved: Record<string, SlotValue> = {};

  for (const [slotId, definition] of Object.entries(useCase.scenario_slots)) {
    const provided = providedSlots[slotId];
    resolved[slotId] = (provided !== undefined ? provided : definition.default) as SlotValue;
  }

  for (const [slotId, value] of Object.entries(providedSlots)) {
    if (!(slotId in resolved)) {
      resolved[slotId] = value as SlotValue;
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// presence_rules -- AND-combined gating on a slot's current value.
// ---------------------------------------------------------------------------

function evaluatePresenceRule(rule: PresenceRule, slots: Record<string, SlotValue>): boolean {
  const value = slots[rule.slot_id];
  switch (rule.condition) {
    case "equals":
      return value === rule.value;
    case "not_equals":
      return value !== rule.value;
    case "includes":
      return Array.isArray(value) && value.includes(rule.value);
    case "excludes":
      return !Array.isArray(value) || !value.includes(rule.value);
    default:
      // Exhaustiveness guard -- a rule with an unrecognized condition should
      // fail loudly rather than silently pass/fail the item.
      throw new Error(`generate_list: unknown presence_rule condition "${String((rule as PresenceRule).condition)}"`);
  }
}

/** An item with no presence_rules (or an empty array) is always present, subject to scaling. */
export function evaluatePresence(item: TemplateListItem, slots: Record<string, SlotValue>): boolean {
  if (!item.presence_rules || item.presence_rules.length === 0) return true;
  return item.presence_rules.every((rule) => evaluatePresenceRule(rule, slots));
}

// ---------------------------------------------------------------------------
// scaling_rules -- qty formulas, summed when an item has more than one.
// ---------------------------------------------------------------------------

/** Extracts the numeric value a scaling_rule operates on: an integer slot's value, or a duration slot's day count. */
function numericSlotValue(slots: Record<string, SlotValue>, slotId: string): number {
  const value = slots[slotId];
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && "count" in value) {
    return (value as DurationValue).count;
  }
  throw new Error(
    `generate_list: slot "${slotId}" does not have a numeric/duration value (got ${JSON.stringify(value)}) -- ` +
      "cannot be used in a scaling_rule.",
  );
}

function applyRound(raw: number, mode: "up" | "down" | "nearest"): number {
  switch (mode) {
    case "up":
      return Math.ceil(raw);
    case "down":
      return Math.floor(raw);
    case "nearest":
      return Math.round(raw);
  }
}

function evaluateLinearRule(rule: ScalingRuleLinear, slots: Record<string, SlotValue>): number {
  const slotValue = numericSlotValue(slots, rule.slot_id);
  const raw = rule.per_unit * slotValue;
  let result = applyRound(raw, rule.round ?? "nearest");
  if (rule.minimum !== undefined) {
    result = Math.max(result, rule.minimum);
  }
  return result;
}

function evaluateStepRule(rule: ScalingRuleStep, slots: Record<string, SlotValue>): number {
  const slotValue = numericSlotValue(slots, rule.slot_id);
  for (const tier of rule.tiers) {
    if (tier.up_to === null || slotValue <= tier.up_to) {
      return tier.qty;
    }
  }
  // Well-formed tiers always end with an up_to: null catch-all; fall back to
  // the last tier rather than throwing if content was authored without one.
  return rule.tiers[rule.tiers.length - 1]?.qty ?? 0;
}

function evaluateScalingRule(rule: ScalingRule, slots: Record<string, SlotValue>): number {
  return rule.method === "linear" ? evaluateLinearRule(rule, slots) : evaluateStepRule(rule, slots);
}

/**
 * Computes an item's quantity: qty.base if it has no scaling_rules, otherwise
 * the sum of every scaling_rule's independently-computed contribution (see
 * /docs/schemas/README.md's "additive, not multiplicative" note).
 */
export function computeQty(item: TemplateListItem, slots: Record<string, SlotValue>): number {
  if (!item.scaling_rules || item.scaling_rules.length === 0) {
    return item.qty.base;
  }
  return item.scaling_rules.reduce((sum, rule) => sum + evaluateScalingRule(rule, slots), 0);
}

// ---------------------------------------------------------------------------
// Shared per-item evaluator -- the seam generate_list and adjust_scenario
// both call, so the rule-evaluation logic exists in exactly one place.
// ---------------------------------------------------------------------------

export interface TemplateItemEvaluation {
  present: boolean;
  /** Only meaningful when `present` is true; 0 when the item isn't present. */
  qty: number;
}

export function evaluateTemplateItem(
  item: TemplateListItem,
  slots: Record<string, SlotValue>,
): TemplateItemEvaluation {
  const present = evaluatePresence(item, slots);
  return { present, qty: present ? computeQty(item, slots) : 0 };
}

function toListItem(item: TemplateListItem, evaluation: TemplateItemEvaluation): ListItem {
  return {
    name: item.name,
    qty: evaluation.qty,
    unit: item.qty.unit,
    category: item.category,
    owned: false,
    source_item_id: item.item_id,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generates a fresh `ListItem[]` for a UseCase at a given (possibly partial)
 * Scenario.slots value map. Pure -- no I/O, deterministic given the same
 * inputs. This is what seeds a new ShoppingList the moment a user starts a
 * Scenario from a UseCase; it is NOT what `adjust_scenario` calls on every
 * edit (that would violate CLAUDE.md locked decision #2 -- see
 * /docs/tool-specs/adjust_scenario.md) -- adjust_scenario instead reuses
 * `evaluateTemplateItem` directly to patch only the affected items.
 */
export function generateList(useCase: UseCaseForList, scenarioSlots: Record<string, unknown> = {}): ListItem[] {
  const resolvedSlots = resolveScenarioSlots(useCase, scenarioSlots);

  const items: ListItem[] = [];
  for (const templateItem of useCase.template_list) {
    const evaluation = evaluateTemplateItem(templateItem, resolvedSlots);
    if (evaluation.present) {
      items.push(toListItem(templateItem, evaluation));
    }
  }
  return items;
}
