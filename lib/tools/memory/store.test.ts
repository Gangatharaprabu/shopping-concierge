import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseMemoryStore } from "./store";
import type { UserMemoryRow } from "@/lib/types";

/**
 * Minimal fake standing in for the subset of the Supabase query builder
 * chain SupabaseMemoryStore actually calls
 * (.from().select().eq().maybeSingle() and .from().upsert().select().single()).
 * No live Supabase credentials exist in this sandbox (same constraint as
 * resolve_products' tests) -- this fake is injected via SupabaseMemoryStore's
 * constructor instead.
 */
function makeFakeSupabase(opts: {
  selectResult?: { data: unknown; error: { message: string } | null };
  upsertResult?: { data: unknown; error: { message: string } | null };
}) {
  const calls: Array<{ op: "select" | "upsert"; table: string; args: unknown[] }> = [];

  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, userId: string) {
              calls.push({ op: "select", table, args: [userId] });
              return {
                maybeSingle: async () => opts.selectResult ?? { data: null, error: null },
              };
            },
          };
        },
        upsert(row: unknown) {
          calls.push({ op: "upsert", table, args: [row] });
          return {
            select() {
              return {
                single: async () => opts.upsertResult ?? { data: null, error: null },
              };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const SAMPLE_ROW: UserMemoryRow = {
  user_id: "user-1",
  household_size: 4,
  dietary_prefs: ["vegan"],
  budget_tier: "mid",
  brand_prefs: ["Kirkland"],
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("SupabaseMemoryStore", () => {
  it("getUserMemory returns the row when one exists", async () => {
    const { client } = makeFakeSupabase({ selectResult: { data: SAMPLE_ROW, error: null } });
    const store = new SupabaseMemoryStore(client);

    const result = await store.getUserMemory("user-1");
    expect(result).toEqual(SAMPLE_ROW);
  });

  it("getUserMemory returns null (not an error) when no row exists", async () => {
    const { client } = makeFakeSupabase({ selectResult: { data: null, error: null } });
    const store = new SupabaseMemoryStore(client);

    const result = await store.getUserMemory("user-1");
    expect(result).toBeNull();
  });

  it("getUserMemory throws a clear error on a Supabase error", async () => {
    const { client } = makeFakeSupabase({ selectResult: { data: null, error: { message: "boom" } } });
    const store = new SupabaseMemoryStore(client);

    await expect(store.getUserMemory("user-1")).rejects.toThrow(/boom/);
  });

  it("upsertUserMemory sends only the keys present in the patch (partial update semantics)", async () => {
    const { client, calls } = makeFakeSupabase({ upsertResult: { data: SAMPLE_ROW, error: null } });
    const store = new SupabaseMemoryStore(client);

    await store.upsertUserMemory("user-1", { household_size: 4 });

    const upsertCall = calls.find((c) => c.op === "upsert");
    expect(upsertCall?.args[0]).toEqual({ user_id: "user-1", household_size: 4 });
  });

  it("upsertUserMemory throws a clear error on a Supabase error", async () => {
    const { client } = makeFakeSupabase({ upsertResult: { data: null, error: { message: "conflict" } } });
    const store = new SupabaseMemoryStore(client);

    await expect(store.upsertUserMemory("user-1", { household_size: 4 })).rejects.toThrow(/conflict/);
  });
});
