/**
 * UI-facing mirror of /docs/schemas/use-case.schema.json's `slot_definition`
 * / `slot_value` (see also lib/tools/generate_list.ts's `SlotDefinitionForList`
 * / `SlotValue`, which this intentionally overlaps with but doesn't import --
 * that module's shape is deliberately narrow, trimmed to what the pure
 * generate_list/adjust_scenario functions need; this one keeps every
 * display-relevant field (label, unit, max_days) a form control needs, same
 * "hand-kept, independently-scoped mirror" approach CLAUDE.md's other
 * type-mirror files use).
 */

export interface DurationValue {
  unit: "event" | "days";
  count: number;
}

export type SlotValue = string | number | string[] | DurationValue;

export interface SlotDefinition {
  type: "enum" | "integer" | "tag_list" | "duration";
  label: string;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  max_days?: number;
  default: SlotValue;
}

export type ScenarioSlots = Record<string, SlotDefinition>;
export type ScenarioSlotValues = Record<string, SlotValue>;

/** Resolves the current value for every declared slot, defaulting anything unset -- mirrors generate_list.ts's resolveScenarioSlots, display-side. */
export function resolveSlotValues(scenarioSlots: ScenarioSlots, values: ScenarioSlotValues): ScenarioSlotValues {
  const resolved: ScenarioSlotValues = {};
  for (const [slotId, def] of Object.entries(scenarioSlots)) {
    resolved[slotId] = values[slotId] !== undefined ? values[slotId] : def.default;
  }
  return resolved;
}
