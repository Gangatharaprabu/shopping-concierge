"use client";

import type { DurationValue, ScenarioSlots, ScenarioSlotValues, SlotValue } from "./scenario-slots";
import { resolveSlotValues } from "./scenario-slots";

export interface ScenarioSlotEditorProps {
  scenarioSlots: ScenarioSlots;
  values: ScenarioSlotValues;
  /** Called with (slotId, newValue) whenever the user changes one slot -- never more than one at a time, mirroring adjust_scenario's one-slot-per-patch contract. */
  onChange: (slotId: string, newValue: SlotValue) => void;
  disabled?: boolean;
}

/**
 * Renders one form control per `scenario_slots` entry, per
 * /docs/schemas/use-case.schema.json's four slot_definition shapes:
 *   - enum -> <select>
 *   - integer -> range slider + number readout, clamped to [min, max]
 *   - tag_list -> a checkbox per declared `options` entry
 *   - duration -> a unit selector (event/days) + a day-count input, only
 *     enabled when unit === "days" ('event' is always exactly 1 day/occurrence)
 *
 * Purely controlled/presentational: takes the current resolved values and an
 * onChange callback, never fetches or persists anything itself -- callers
 * (StartScenarioForm for a not-yet-created list, ScenarioEditorPanel for an
 * existing one) own persistence, which differs a lot between the two
 * (generate_list vs. adjust_scenario).
 */
export default function ScenarioSlotEditor({ scenarioSlots, values, onChange, disabled }: ScenarioSlotEditorProps) {
  const resolved = resolveSlotValues(scenarioSlots, values);

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(scenarioSlots).map(([slotId, def]) => {
        const value = resolved[slotId];

        if (def.type === "enum") {
          const current = typeof value === "string" ? value : String(def.default);
          return (
            <Field key={slotId} label={def.label} htmlFor={slotId}>
              <select
                id={slotId}
                disabled={disabled}
                value={current}
                onChange={(e) => onChange(slotId, e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {(def.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </Field>
          );
        }

        if (def.type === "integer") {
          const current = typeof value === "number" ? value : Number(def.default);
          const min = def.min ?? 0;
          const max = def.max ?? Math.max(min + 1, current);
          return (
            <Field key={slotId} label={`${def.label}${def.unit ? ` (${def.unit})` : ""}`} htmlFor={slotId}>
              <div className="flex items-center gap-3">
                <input
                  id={slotId}
                  type="range"
                  disabled={disabled}
                  min={min}
                  max={max}
                  value={current}
                  onChange={(e) => onChange(slotId, Number(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  aria-label={`${def.label} value`}
                  disabled={disabled}
                  min={min}
                  max={max}
                  value={current}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) onChange(slotId, n);
                  }}
                  className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              </div>
            </Field>
          );
        }

        if (def.type === "tag_list") {
          const current = Array.isArray(value) ? value : [];
          const options = def.options ?? [];
          return (
            <Field key={slotId} label={def.label}>
              <div className="flex flex-wrap gap-3">
                {options.map((opt) => {
                  const checked = current.includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={() => {
                          const next = checked ? current.filter((v) => v !== opt) : [...current, opt];
                          onChange(slotId, next);
                        }}
                      />
                      {opt}
                    </label>
                  );
                })}
                {options.length === 0 && <span className="text-sm text-zinc-500">No options declared.</span>}
              </div>
            </Field>
          );
        }

        // duration
        const current: DurationValue =
          value && typeof value === "object" && !Array.isArray(value) ? (value as DurationValue) : { unit: "event", count: 1 };
        return (
          <Field key={slotId} label={def.label}>
            <div className="flex items-center gap-3">
              <select
                aria-label={`${def.label} unit`}
                disabled={disabled}
                value={current.unit}
                onChange={(e) => {
                  const unit = e.target.value as DurationValue["unit"];
                  // Switching *to* days from event: event's count is always
                  // pinned at 1, which isn't a useful multi-day default, so
                  // seed with 2 instead of carrying the pinned 1 over.
                  const nextCount = current.unit === "event" ? 2 : current.count || 2;
                  onChange(slotId, unit === "event" ? { unit, count: 1 } : { unit, count: nextCount });
                }}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="event">single event</option>
                <option value="days">multi-day</option>
              </select>
              <input
                type="number"
                aria-label={`${def.label} day count`}
                disabled={disabled || current.unit === "event"}
                min={1}
                max={def.max_days}
                value={current.unit === "event" ? 1 : current.count}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n)) onChange(slotId, { unit: "days", count: n });
                }}
                className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-50"
              />
              {current.unit === "days" && <span className="text-sm text-zinc-500">days</span>}
            </div>
          </Field>
        );
      })}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
    </div>
  );
}
