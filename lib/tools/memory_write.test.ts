import { describe, expect, it } from "vitest";
import { MemoryBoundaryError, memoryWrite, type UserMemoryPatch } from "./memory_write";
import type { DurableMemoryFields, MemoryStore } from "./memory/store";
import type { UserMemoryRow } from "@/lib/types";

class FakeMemoryStore implements MemoryStore {
  private rows = new Map<string, UserMemoryRow>();
  public upsertCalls: Array<{ userId: string; patch: DurableMemoryFields }> = [];

  async getUserMemory(userId: string): Promise<UserMemoryRow | null> {
    return this.rows.get(userId) ?? null;
  }

  async upsertUserMemory(userId: string, patch: DurableMemoryFields): Promise<UserMemoryRow> {
    this.upsertCalls.push({ userId, patch });
    const existing: UserMemoryRow = this.rows.get(userId) ?? {
      user_id: userId,
      household_size: null,
      dietary_prefs: [],
      budget_tier: null,
      brand_prefs: [],
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const updated: UserMemoryRow = {
      ...existing,
      ...(patch.household_size !== undefined ? { household_size: patch.household_size } : {}),
      ...(patch.dietary_prefs !== undefined ? { dietary_prefs: patch.dietary_prefs } : {}),
      ...(patch.budget_tier !== undefined ? { budget_tier: patch.budget_tier } : {}),
      ...(patch.brand_prefs !== undefined ? { brand_prefs: patch.brand_prefs } : {}),
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    this.rows.set(userId, updated);
    return updated;
  }
}

describe("memoryWrite — normal writes", () => {
  it("writes only the supplied durable fields, leaving others untouched (patch semantics)", async () => {
    const store = new FakeMemoryStore();
    await store.upsertUserMemory("user-1", { household_size: 4, budget_tier: "mid" });
    store.upsertCalls = []; // reset call log, keep seeded state

    const result = await memoryWrite(
      "user-1",
      { dietary_prefs: ["vegan"], source: "user_confirmed" },
      { store }
    );

    expect(result.household_size).toBe(4); // unspecified field preserved
    expect(result.budget_tier).toBe("mid"); // unspecified field preserved
    expect(result.dietary_prefs).toEqual(["vegan"]); // newly written field applied

    // `source` must never reach the persistence layer -- it's a guard marker, not a column.
    expect(store.upsertCalls).toHaveLength(1);
    expect(store.upsertCalls[0].patch).toEqual({ dietary_prefs: ["vegan"] });
    expect("source" in store.upsertCalls[0].patch).toBe(false);
  });

  it("round-trips through memoryRead-equivalent shape", async () => {
    const store = new FakeMemoryStore();

    const result = await memoryWrite(
      "user-1",
      { household_size: 2, dietary_prefs: [], budget_tier: "high", brand_prefs: ["Costco"], source: "user_confirmed" },
      { store }
    );

    expect(result).toEqual({
      user_id: "user-1",
      household_size: 2,
      dietary_prefs: [],
      budget_tier: "high",
      brand_prefs: ["Costco"],
      updated_at: "2026-02-01T00:00:00.000Z",
    });
  });
});

describe("memoryWrite — the `source: \"user_confirmed\"` guard", () => {
  it("throws MemoryBoundaryError and writes nothing when source is missing", async () => {
    const store = new FakeMemoryStore();
    // Simulate a caller that bypassed TypeScript (e.g. parsed tool_use JSON args
    // cast without validation) rather than a compile-time-valid call.
    const patch = { household_size: 4 } as unknown as UserMemoryPatch;

    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(MemoryBoundaryError);
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("throws MemoryBoundaryError and writes nothing when source is any value other than 'user_confirmed'", async () => {
    const store = new FakeMemoryStore();
    const patch = { household_size: 4, source: "inferred" } as unknown as UserMemoryPatch;

    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(MemoryBoundaryError);
    expect(store.upsertCalls).toHaveLength(0);
  });
});

describe("memoryWrite — session data cannot be smuggled in (the memory boundary)", () => {
  it("[runtime] throws MemoryBoundaryError and writes nothing for a patch containing a Scenario-shaped field", async () => {
    const store = new FakeMemoryStore();
    // A caller that bypassed the type system (e.g. forwarded parsed tool_use
    // JSON, or a careless `as any` cast of Scenario.slots) tries to smuggle
    // session-only fields through. This is the runtime half of the "no
    // session data can be smuggled in" guarantee -- see the compile-time
    // half below.
    const patch = {
      dietary_prefs: ["vegan"],
      source: "user_confirmed",
      time_of_day: "night", // Scenario slot, not a UserMemory field
      headcount: 20, // Scenario slot, not a UserMemory field
    } as unknown as UserMemoryPatch;

    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(MemoryBoundaryError);
    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(/time_of_day/);
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("[runtime] rejects a patch that is literally a Scenario.slots-shaped object forwarded wholesale", async () => {
    const store = new FakeMemoryStore();
    // Stands in for the exact cautionary example documented in memory_write.ts:
    // a naive harness forwarding an entire Scenario.slots object because one
    // key (`dietary`) happens to look memory-shaped.
    const scenarioSlots = {
      time_of_day: "night",
      headcount: 20,
      dietary: "vegan",
    };

    const patch = { ...scenarioSlots, source: "user_confirmed" } as unknown as UserMemoryPatch;

    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(MemoryBoundaryError);
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("[compile-time] TypeScript rejects a Scenario-shaped object literal at the call site", () => {
    // This test's only purpose is the two @ts-expect-error assertions below --
    // if UserMemoryPatch's shape is ever loosened to accept extra/session
    // fields, `tsc` (e.g. via `npm run build`) will fail on this file because
    // these lines would stop being type errors. `expect(true).toBe(true)` just
    // gives vitest something to run; the real assertion is at compile time.
    const store = new FakeMemoryStore();

    // These calls are never awaited and their rejection is intentionally
    // swallowed -- runtime behavior isn't the point here (it's already
    // covered by the "[runtime]" tests above). The only assertion that
    // matters is that `tsc` reports an error on each line below; if
    // UserMemoryPatch's shape is ever loosened to accept extra/session
    // fields, these @ts-expect-error comments will themselves become
    // compile errors (an unused @ts-expect-error is a type error), which
    // is exactly the signal we want.

    // @ts-expect-error -- Scenario slot fields are not part of UserMemoryPatch.
    memoryWrite("user-1", { time_of_day: "night", source: "user_confirmed" }, { store }).catch(() => {});

    // @ts-expect-error -- forwarding a whole Scenario.slots-shaped object must not type-check.
    memoryWrite("user-1", { headcount: 20, dietary: "vegan", source: "user_confirmed" }, { store }).catch(() => {});

    expect(true).toBe(true);
  });
});

describe("memoryWrite — durable field value validation", () => {
  it("rejects a non-positive household_size", async () => {
    const store = new FakeMemoryStore();
    await expect(
      memoryWrite("user-1", { household_size: -1, source: "user_confirmed" }, { store })
    ).rejects.toThrow(MemoryBoundaryError);
  });

  it("rejects an invalid budget_tier", async () => {
    const store = new FakeMemoryStore();
    const patch = { budget_tier: "premium", source: "user_confirmed" } as unknown as UserMemoryPatch;
    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(MemoryBoundaryError);
  });

  it("rejects a non-string-array dietary_prefs", async () => {
    const store = new FakeMemoryStore();
    const patch = { dietary_prefs: "vegan", source: "user_confirmed" } as unknown as UserMemoryPatch;
    await expect(memoryWrite("user-1", patch, { store })).rejects.toThrow(MemoryBoundaryError);
  });

  it("allows explicit null to clear household_size / budget_tier", async () => {
    const store = new FakeMemoryStore();
    await store.upsertUserMemory("user-1", { household_size: 4, budget_tier: "mid" });
    store.upsertCalls = [];

    const result = await memoryWrite(
      "user-1",
      { household_size: null, budget_tier: null, source: "user_confirmed" },
      { store }
    );

    expect(result.household_size).toBeNull();
    expect(result.budget_tier).toBeNull();
  });
});
