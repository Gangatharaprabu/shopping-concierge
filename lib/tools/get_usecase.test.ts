import { describe, expect, it, vi } from "vitest";
import type { UseCaseRow } from "../types";
import { getUseCase, type UseCasePersistence } from "./get_usecase";

function useCaseRow(overrides: Partial<UseCaseRow> = {}): UseCaseRow {
  return {
    id: "backyard-bbq-cookout",
    title: "Backyard BBQ Cookout",
    description: null,
    category: "events",
    subcategory: "events.bbq_grilling",
    tags: ["grilling"],
    scenario_slots: {},
    template_list: [],
    embedding: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getUseCase", () => {
  it("returns the use case from deps.persistence.getUseCase", async () => {
    const row = useCaseRow();
    const persistence: UseCasePersistence = { getUseCase: vi.fn().mockResolvedValue(row) };

    const result = await getUseCase("backyard-bbq-cookout", { persistence });

    expect(result).toBe(row);
    expect(persistence.getUseCase).toHaveBeenCalledWith("backyard-bbq-cookout");
  });

  it("returns null (not an error) when the persistence layer finds nothing", async () => {
    const persistence: UseCasePersistence = { getUseCase: vi.fn().mockResolvedValue(null) };

    const result = await getUseCase("no-such-id", { persistence });

    expect(result).toBeNull();
  });

  it("throws a clear, actionable error when deps is omitted rather than attempting a network call", async () => {
    await expect(getUseCase("backyard-bbq-cookout")).rejects.toThrow(/deps\.persistence/);
  });
});
