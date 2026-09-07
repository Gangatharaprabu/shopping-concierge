/**
 * TypeScript mirror of /docs/schemas/use-case.schema.json.
 *
 * This is intentionally hand-kept in sync with the JSON Schema rather than
 * generated from it (the schema is small and stable). The JSON Schema file
 * remains the source of truth for validation — these types exist purely to
 * give the batch-generation/authoring scripts compile-time safety. Runtime
 * correctness is always re-checked against the real schema via ajv in
 * `schema-validate.ts`, never assumed from these types alone.
 */

export type CanonicalSlotId =
  | "time_of_day"
  | "headcount"
  | "setting"
  | "budget_tier"
  | "dietary"
  | "duration";

export type SlotId = CanonicalSlotId | (string & {});

export interface DurationValue {
  unit: "event" | "days";
  count: number;
}

export interface EnumSlotDefinition {
  type: "enum";
  label: string;
  description?: string;
  options: string[];
  default: string;
}

export interface IntegerSlotDefinition {
  type: "integer";
  label: string;
  description?: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface TagListSlotDefinition {
  type: "tag_list";
  label: string;
  description?: string;
  options?: string[];
  default: string[];
}

export interface DurationSlotDefinition {
  type: "duration";
  label: string;
  description?: string;
  max_days?: number;
  default: DurationValue;
}

export type SlotDefinition =
  | EnumSlotDefinition
  | IntegerSlotDefinition
  | TagListSlotDefinition
  | DurationSlotDefinition;

export interface PresenceRule {
  slot_id: SlotId;
  condition: "equals" | "not_equals" | "includes" | "excludes";
  value: string;
}

export interface ScalingRuleLinear {
  slot_id: SlotId;
  method: "linear";
  per_unit: number;
  round?: "up" | "down" | "nearest";
  minimum?: number;
}

export interface ScalingRuleStep {
  slot_id: SlotId;
  method: "step";
  tiers: Array<{ up_to: number | null; qty: number }>;
}

export type ScalingRule = ScalingRuleLinear | ScalingRuleStep;

export interface Qty {
  base: number;
  unit: string;
}

export interface TemplateListItem {
  item_id: string;
  name: string;
  category: string;
  qty: Qty;
  depends_on_slots: SlotId[];
  presence_rules?: PresenceRule[];
  scaling_rules?: ScalingRule[];
  notes?: string;
}

export interface UseCase {
  id: string;
  title: string;
  description?: string;
  category: "events" | "travel" | "home" | "seasonal";
  subcategory: string;
  tags: string[];
  scenario_slots: Record<string, SlotDefinition>;
  template_list: TemplateListItem[];
}
