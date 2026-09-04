/**
 * Validation module for generated UseCase records.
 *
 * This is the "script, not LLM judgment" validation step referenced in the
 * usecase-content-agent brief: every record produced by generate-batch.ts
 * (or hand-authored) must pass `validateUseCase` before it is written to
 * /db/seed/usecases. Nothing here uses an LLM.
 *
 * Two layers:
 *  1. JSON Schema validation against /docs/schemas/use-case.schema.json
 *     (draft 2020-12, via ajv), which also pulls in category-taxonomy.json's
 *     `$defs.category` / `$defs.subcategory` enums through its $ref.
 *  2. Semantic lint rules that JSON Schema can't express alone. The schema
 *     README (/docs/schemas/README.md, "Deliberate omissions") explicitly
 *     calls out two of these:
 *       (a) every slot_id referenced in an item's presence_rules/
 *           scaling_rules must also appear in that item's depends_on_slots.
 *       (b) each slot_definition.default must be a valid value for its own
 *           options/min-max.
 *     We also lint two additional structural rules that are genuine gaps in
 *     the JSON Schema (not fixed there per this task's instructions — see
 *     the PIPELINE_README.md "Schema gaps found" section for why):
 *       (c) UseCase.subcategory must be namespaced under UseCase.category
 *           (e.g. category "events" + subcategory "home.moving_in" is
 *           accepted by the schema today because category and subcategory
 *           are validated against independent enums with no cross-check).
 *       (d) template_list[].item_id must be unique within one UseCase (the
 *           schema only constrains the *shape* of each item_id, not
 *           uniqueness across the array).
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import type { UseCase, SlotDefinition, TemplateListItem } from "./types.js";

const SCHEMAS_DIR = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../../docs/schemas"
);

export interface ValidationResult {
  id: string | undefined;
  valid: boolean;
  schemaErrors: string[];
  lintErrors: string[];
}

let compiledValidator: ReturnType<Ajv2020["compile"]> | null = null;

function getValidator() {
  if (compiledValidator) return compiledValidator;

  const useCaseSchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "use-case.schema.json"), "utf-8")
  );
  const taxonomySchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "category-taxonomy.json"), "utf-8")
  );

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  // taxonomySchema declares its own $id matching the relative ref
  // ("category-taxonomy.json") used from use-case.schema.json, so adding it
  // here is enough for $ref resolution -- no manual id remapping needed.
  ajv.addSchema(taxonomySchema);
  compiledValidator = ajv.compile(useCaseSchema);
  return compiledValidator;
}

/** Lint rule (a): every presence_rules/scaling_rules slot_id must be declared in depends_on_slots. */
function lintDependsOnSlots(item: TemplateListItem, errors: string[]) {
  const declared = new Set(item.depends_on_slots ?? []);
  for (const rule of item.presence_rules ?? []) {
    if (!declared.has(rule.slot_id)) {
      errors.push(
        `template_list[item_id=${item.item_id}]: presence_rules references slot_id "${rule.slot_id}" which is missing from depends_on_slots`
      );
    }
  }
  for (const rule of item.scaling_rules ?? []) {
    if (!declared.has(rule.slot_id)) {
      errors.push(
        `template_list[item_id=${item.item_id}]: scaling_rules references slot_id "${rule.slot_id}" which is missing from depends_on_slots`
      );
    }
  }
}

/** Lint rule (b): slot_definition.default must be valid for its own type's options/min-max. */
function lintSlotDefault(slotId: string, def: SlotDefinition, errors: string[]) {
  switch (def.type) {
    case "enum": {
      if (!def.options.includes(def.default)) {
        errors.push(
          `scenario_slots.${slotId}: default "${def.default}" is not one of options [${def.options.join(", ")}]`
        );
      }
      break;
    }
    case "integer": {
      if (def.default < def.min || def.default > def.max) {
        errors.push(
          `scenario_slots.${slotId}: default ${def.default} is outside [min=${def.min}, max=${def.max}]`
        );
      }
      break;
    }
    case "tag_list": {
      if (def.options) {
        const optionSet = new Set(def.options);
        for (const tag of def.default) {
          if (!optionSet.has(tag)) {
            errors.push(
              `scenario_slots.${slotId}: default tag "${tag}" is not one of options [${def.options.join(", ")}]`
            );
          }
        }
      }
      break;
    }
    case "duration": {
      if (def.default.unit === "event" && def.default.count !== 1) {
        errors.push(
          `scenario_slots.${slotId}: default has unit "event" but count ${def.default.count} !== 1`
        );
      }
      if (def.max_days != null && def.default.unit === "days" && def.default.count > def.max_days) {
        errors.push(
          `scenario_slots.${slotId}: default day count ${def.default.count} exceeds max_days ${def.max_days}`
        );
      }
      break;
    }
  }
}

/** Lint rule (c): subcategory must be namespaced under category, e.g. "events.bbq_grilling" under "events". */
function lintCategoryNamespace(useCase: UseCase, errors: string[]) {
  if (!useCase.subcategory?.startsWith(`${useCase.category}.`)) {
    errors.push(
      `subcategory "${useCase.subcategory}" is not namespaced under category "${useCase.category}" (expected prefix "${useCase.category}.")`
    );
  }
}

/** Lint rule (d): item_id must be unique within one UseCase's template_list. */
function lintItemIdUniqueness(useCase: UseCase, errors: string[]) {
  const seen = new Map<string, number>();
  for (const item of useCase.template_list ?? []) {
    seen.set(item.item_id, (seen.get(item.item_id) ?? 0) + 1);
  }
  for (const [itemId, count] of seen) {
    if (count > 1) {
      errors.push(`template_list: item_id "${itemId}" is used ${count} times (must be unique within one UseCase)`);
    }
  }
}

/** Lint rule (e): every slot_id used in depends_on_slots/presence_rules/scaling_rules must be declared in scenario_slots. */
function lintSlotReferencesExist(useCase: UseCase, errors: string[]) {
  const declaredSlots = new Set(Object.keys(useCase.scenario_slots ?? {}));
  for (const item of useCase.template_list ?? []) {
    for (const slotId of item.depends_on_slots ?? []) {
      if (!declaredSlots.has(slotId)) {
        errors.push(
          `template_list[item_id=${item.item_id}]: depends_on_slots references slot_id "${slotId}" which is not declared in scenario_slots`
        );
      }
    }
  }
}

export function lintUseCase(useCase: UseCase): string[] {
  const errors: string[] = [];

  lintCategoryNamespace(useCase, errors);
  lintItemIdUniqueness(useCase, errors);
  lintSlotReferencesExist(useCase, errors);

  for (const [slotId, def] of Object.entries(useCase.scenario_slots ?? {})) {
    lintSlotDefault(slotId, def, errors);
  }
  for (const item of useCase.template_list ?? []) {
    lintDependsOnSlots(item, errors);
  }

  return errors;
}

export function validateUseCase(data: unknown): ValidationResult {
  const validator = getValidator();
  const schemaValid = validator(data);
  const schemaErrors = schemaValid
    ? []
    : (validator.errors ?? []).map(
        (e) => `${e.instancePath || "(root)"} ${e.message}` + (e.params ? ` ${JSON.stringify(e.params)}` : "")
      );

  // Only run semantic lint if the record is at least shape-valid -- lint
  // rules assume the fields they inspect exist and are well-typed.
  const lintErrors = schemaValid ? lintUseCase(data as UseCase) : [];

  const id = typeof (data as { id?: unknown })?.id === "string" ? (data as { id: string }).id : undefined;

  return {
    id,
    valid: schemaErrors.length === 0 && lintErrors.length === 0,
    schemaErrors,
    lintErrors,
  };
}
