import { describe, expect, it } from "vitest";
import { memoryRead } from "./memory_read";
import type { MemoryStore } from "./memory/store";
import type { UserMemoryRow } from "@/lib/types";

class FakeMemoryStore implements MemoryStore {
  constructor(private readonly rows = new Map<string, UserMemoryRow>()) {}

  async getUserMemory(userId: string): Promise<UserMemoryRow | null> {
    return this.rows.get(userId) ?? null;
  }

  // Fewer params than MemoryStore.upsertUserMemory declares is valid TS function
  // subtyping -- only here to satisfy the interface, memory_read never writes.
  async upsertUserMemory(): Promise<UserMemoryRow> {
    throw new Error("not used in memory_read tests");
  }
}

const SAMPLE_ROW: UserMemoryRow = {
  user_id: "user-1",
  household_size: 3,
  dietary_prefs: ["vegetarian"],
  budget_tier: "low",
  brand_prefs: [],
  updated_at: "2026-02-01T00:00:00.000Z",
};

describe("memoryRead", () => {
  it("returns the caller's existing durable UserMemory record unchanged", async () => {
    const store = new FakeMemoryStore(new Map([["user-1", SAMPLE_ROW]]));

    const result = await memoryRead("user-1", { store });

    expect(result).toEqual(SAMPLE_ROW);
  });

  it("returns an all-empty default shape (not an error) for a user with no memory row yet", async () => {
    const store = new FakeMemoryStore();

    const result = await memoryRead("user-2", { store });

    expect(result).toEqual({
      user_id: "user-2",
      household_size: null,
      dietary_prefs: [],
      budget_tier: null,
      brand_prefs: [],
      updated_at: null,
    });
  });

  it("never returns fields outside the five durable UserMemory keys", async () => {
    const store = new FakeMemoryStore(new Map([["user-1", SAMPLE_ROW]]));

    const result = await memoryRead("user-1", { store });

    expect(Object.keys(result).sort()).toEqual(
      ["brand_prefs", "budget_tier", "dietary_prefs", "household_size", "updated_at", "user_id"].sort()
    );
  });
});
