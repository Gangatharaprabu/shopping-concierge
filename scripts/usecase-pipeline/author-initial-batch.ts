#!/usr/bin/env -S npx tsx
/**
 * One-off authoring script for the FIRST hand-authored batch of UseCase
 * seed data (see the task brief: no ANTHROPIC_API_KEY is available in this
 * environment, so this batch was hand-authored directly rather than
 * generated via generate-batch.ts). Every record below was written by a
 * human/agent decision about what belongs in that scenario -- this script
 * exists only to get compile-time type-checking (via lib/types.ts) and
 * consistent serialization, not to auto-generate content.
 *
 * Every record is still put through the exact same validate -> dedup ->
 * write pipeline as generate-batch.ts would use, and is logged into the
 * same state file with source: "hand-authored" so future runs of
 * generate-batch.ts (with a real API key) know this ground has already
 * been covered and will top up remaining subcategories/counts instead of
 * duplicating it.
 *
 * Run: npx tsx scripts/usecase-pipeline/author-initial-batch.ts
 */

import fs from "node:fs";
import path from "node:path";
import { validateUseCase } from "./lib/schema-validate.js";
import { findNearDuplicates, type DedupCandidate } from "./lib/dedup.js";
import { recordBatch } from "./lib/state.js";
import { Logger } from "./lib/logger.js";
import type {
  UseCase,
  TemplateListItem,
  EnumSlotDefinition,
  IntegerSlotDefinition,
  TagListSlotDefinition,
  DurationSlotDefinition,
  PresenceRule,
  ScalingRule,
  DurationValue,
} from "./lib/types.js";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const SEED_DIR = path.join(ROOT, "db/seed/usecases");
const STATE_FILE = path.join(ROOT, "scripts/usecase-pipeline/state/generation-state.json");
const LOG_FILE = path.join(ROOT, "scripts/usecase-pipeline/logs/pipeline.log");

// ---- slot-definition helpers -------------------------------------------------

function enumSlot(label: string, options: string[], def: string): EnumSlotDefinition {
  return { type: "enum", label, options, default: def };
}
function intSlot(label: string, min: number, max: number, def: number, unit?: string): IntegerSlotDefinition {
  return { type: "integer", label, min, max, default: def, unit };
}
function tagListSlot(label: string, options: string[] | undefined, def: string[] = []): TagListSlotDefinition {
  return { type: "tag_list", label, options, default: def };
}
function durationSlot(label: string, maxDays: number, def: DurationValue): DurationSlotDefinition {
  return { type: "duration", label, max_days: maxDays, default: def };
}

// ---- template_list_item helpers ----------------------------------------------

function pr(slotId: string, condition: PresenceRule["condition"], value: string): PresenceRule {
  return { slot_id: slotId, condition, value };
}
function linear(slotId: string, perUnit: number, round?: "up" | "down" | "nearest", minimum?: number): ScalingRule {
  return { slot_id: slotId, method: "linear", per_unit: perUnit, round, minimum };
}
function step(slotId: string, tiers: Array<{ up_to: number | null; qty: number }>): ScalingRule {
  return { slot_id: slotId, method: "step", tiers };
}
function item(
  itemId: string,
  name: string,
  category: string,
  base: number,
  unit: string,
  dependsOn: string[],
  opts?: { presence?: PresenceRule[]; scaling?: ScalingRule[]; notes?: string }
): TemplateListItem {
  return {
    item_id: itemId,
    name,
    category,
    qty: { base, unit },
    depends_on_slots: dependsOn,
    ...(opts?.presence ? { presence_rules: opts.presence } : {}),
    ...(opts?.scaling ? { scaling_rules: opts.scaling } : {}),
    ...(opts?.notes ? { notes: opts.notes } : {}),
  };
}

// ---- the batch -----------------------------------------------------------

const useCases: UseCase[] = [
  // ============================== EVENTS ==================================

  {
    id: "fourth-of-july-grill-party",
    title: "Fourth of July Grill Party",
    description: "A bigger backyard cookout for the Fourth, with fireworks-viewing extras.",
    category: "events",
    subcategory: "events.bbq_grilling",
    tags: ["grilling", "summer", "holiday", "outdoor", "fireworks"],
    scenario_slots: {
      time_of_day: enumSlot("Time of day", ["day", "night"], "night"),
      headcount: intSlot("Guests", 4, 150, 20, "guests"),
      setting: enumSlot("Setting", ["outdoor", "mixed"], "outdoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegetarian", "vegan", "gluten_free", "nut_free"], []),
    },
    template_list: [
      item("charcoal_briquettes", "Charcoal briquettes", "fuel", 2.4, "kg", ["headcount"], {
        scaling: [linear("headcount", 0.3, "up", 1)],
      }),
      item("hot_dogs", "Hot dogs", "food", 16, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "vegan")],
        scaling: [linear("headcount", 2, "up")],
      }),
      item("veggie_dogs", "Veggie dogs", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 2, "up")],
      }),
      item("sparklers", "Sparklers", "decor", 8, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("red_white_blue_decorations", "Red, white & blue decorations", "decor", 1, "set", []),
      item("cooler", "Cooler", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 15, qty: 1 }, { up_to: 40, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("citronella_candles", "Citronella candles", "gear", 4, "count", ["time_of_day", "setting"], {
        presence: [pr("time_of_day", "equals", "night"), pr("setting", "equals", "outdoor")],
        notes: "Two-slot gate: only present for an outdoor evening party.",
      }),
      item("lawn_chairs", "Lawn chairs", "gear", 6, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 10, qty: 6 }, { up_to: 30, qty: 15 }, { up_to: null, qty: 25 }])],
      }),
    ],
  },

  {
    id: "vegan-bbq-night",
    title: "Vegan BBQ Night",
    description: "A plant-based cookout for guests who don't eat meat or dairy.",
    category: "events",
    subcategory: "events.bbq_grilling",
    tags: ["grilling", "vegan", "plant-based", "outdoor"],
    scenario_slots: {
      headcount: intSlot("Guests", 2, 40, 10, "guests"),
      setting: enumSlot("Setting", ["outdoor", "indoor", "mixed"], "outdoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegan", "gluten_free", "nut_free"], ["vegan"]),
    },
    template_list: [
      item("grill_tongs", "Grill tongs", "gear", 1, "pair", []),
      item("veggie_burger_patties", "Veggie burger patties", "food", 10, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("grilled_corn", "Corn on the cob", "food", 10, "ears", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("vegan_bbq_sauce", "Vegan BBQ sauce", "food", 1, "bottle", ["headcount"], {
        scaling: [linear("headcount", 0.1, "up", 1)],
      }),
      item("gluten_free_buns", "Gluten-free buns", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "gluten_free")],
        scaling: [linear("headcount", 1, "up")],
      }),
      item("charcoal_briquettes", "Charcoal briquettes", "fuel", 2.4, "kg", ["headcount"], {
        scaling: [linear("headcount", 0.3, "up", 1)],
      }),
      item("reusable_plates", "Reusable plates", "gear", 10, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 10, qty: 10 }, { up_to: 25, qty: 25 }, { up_to: null, qty: 40 }])],
      }),
      item("citronella_candles", "Citronella candles", "gear", 4, "count", []),
    ],
  },

  {
    id: "kids-birthday-party-bounce-house",
    title: "Kids Birthday Party with Bounce House",
    description: "A backyard birthday bash for a class' worth of kids, centered on a bounce house rental.",
    category: "events",
    subcategory: "events.birthday_party",
    tags: ["birthday", "kids", "bounce-house", "party"],
    scenario_slots: {
      headcount: intSlot("Kids attending", 4, 40, 15, "kids"),
      setting: enumSlot("Setting", ["outdoor", "indoor", "mixed"], "outdoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["nut_free", "gluten_free"], []),
    },
    template_list: [
      item("bounce_house_rental", "Bounce house rental", "rental", 1, "rental", []),
      item("birthday_cake", "Birthday cake", "food", 1, "cake", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 15, qty: 1 }, { up_to: 30, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("balloons", "Balloons", "decor", 30, "count", ["headcount"], {
        scaling: [linear("headcount", 2, "up")],
      }),
      item("loot_bags", "Loot bags", "party-favors", 15, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("juice_boxes", "Juice boxes", "food", 30, "count", ["headcount"], {
        scaling: [linear("headcount", 2, "up")],
      }),
      item("nut_free_snack_mix", "Nut-free snack mix", "food", 0, "bag", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "nut_free")],
        scaling: [linear("headcount", 0.2, "up", 1)],
      }),
      item("paper_plates", "Paper plates", "gear", 15, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 15, qty: 15 }, { up_to: 30, qty: 30 }, { up_to: null, qty: 50 }])],
      }),
      item("happy_birthday_banner", "Happy Birthday banner", "decor", 1, "count", []),
    ],
  },

  {
    id: "milestone-adult-birthday-at-home",
    title: "Milestone Adult Birthday at Home",
    description: "A 30th/40th/50th-style birthday celebration hosted at home in the evening.",
    category: "events",
    subcategory: "events.birthday_party",
    tags: ["birthday", "adult", "milestone", "celebration"],
    scenario_slots: {
      time_of_day: enumSlot("Time of day", ["day", "night"], "night"),
      headcount: intSlot("Guests", 4, 60, 20, "guests"),
      setting: enumSlot("Setting", ["indoor", "outdoor", "mixed"], "indoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegan", "vegetarian", "gluten_free"], []),
    },
    template_list: [
      item("birthday_cake", "Birthday cake", "food", 1, "cake", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 20, qty: 1 }, { up_to: 40, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("vegan_cake_alternative", "Vegan cake alternative", "food", 0, "cake", ["dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
      }),
      item("champagne", "Champagne for toasting", "drinks", 3, "bottle", ["headcount"], {
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("string_lights", "String lights", "decor", 1, "set", ["time_of_day"], {
        presence: [pr("time_of_day", "equals", "night")],
      }),
      item("photo_backdrop", "Photo backdrop", "decor", 1, "set", []),
      item("plastic_cups", "Plastic cups", "gear", 20, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 20, qty: 20 }, { up_to: 40, qty: 40 }, { up_to: null, qty: 70 }])],
      }),
    ],
  },

  {
    id: "backyard-kids-birthday-budget",
    title: "Backyard Kids Birthday Party on a Budget",
    description: "A low-cost, DIY-leaning kids birthday party at home.",
    category: "events",
    subcategory: "events.birthday_party",
    tags: ["birthday", "kids", "budget", "diy"],
    scenario_slots: {
      headcount: intSlot("Kids attending", 4, 30, 12, "kids"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "low"),
      dietary: tagListSlot("Dietary needs", ["nut_free"], []),
    },
    template_list: [
      item("diy_pinata", "DIY piñata kit", "party-favors", 1, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "high")],
      }),
      item("hired_entertainer", "Hired entertainer / magician", "rental", 1, "booking", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("balloons", "Balloons", "decor", 24, "count", ["headcount"], {
        scaling: [linear("headcount", 2, "up")],
      }),
      item("homemade_cupcakes", "Homemade cupcakes", "food", 12, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("juice_boxes", "Juice boxes", "food", 12, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("paper_tablecloth", "Paper tablecloth", "gear", 1, "count", []),
      item("nut_free_treats", "Nut-free treat bags", "food", 0, "bag", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "nut_free")],
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "thanksgiving-dinner-extended-family",
    title: "Thanksgiving Dinner for the Extended Family",
    description: "A full sit-down Thanksgiving dinner with the classic sides, sized for extended family.",
    category: "events",
    subcategory: "events.holiday_dinner",
    tags: ["thanksgiving", "holiday", "dinner", "family"],
    scenario_slots: {
      headcount: intSlot("Guests", 4, 30, 12, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegetarian", "vegan", "gluten_free", "nut_free"], []),
    },
    template_list: [
      item("roast_turkey", "Roast turkey", "food", 12, "lb", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "vegetarian"), pr("dietary", "excludes", "vegan")],
        scaling: [linear("headcount", 1, "up", 8)],
      }),
      item("vegetarian_wellington", "Vegetarian wellington", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegetarian")],
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("vegan_wellington", "Vegan wellington", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("mashed_potatoes", "Mashed potatoes", "food", 6, "lb", ["headcount"], {
        scaling: [linear("headcount", 0.5, "up")],
      }),
      item("stuffing", "Stuffing", "food", 4, "lb", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "gluten_free")],
        scaling: [linear("headcount", 0.35, "up")],
      }),
      item("gluten_free_stuffing", "Gluten-free stuffing", "food", 0, "lb", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "gluten_free")],
        scaling: [linear("headcount", 0.35, "up")],
      }),
      item("cranberry_sauce", "Cranberry sauce", "food", 2, "jar", ["headcount"], {
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("dinner_rolls", "Dinner rolls", "food", 12, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 12, qty: 12 }, { up_to: 25, qty: 25 }, { up_to: null, qty: 40 }])],
      }),
      item("pumpkin_pie", "Pumpkin pie", "food", 1, "pie", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 8, qty: 1 }, { up_to: 16, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
    ],
  },

  {
    id: "christmas-eve-family-dinner",
    title: "Christmas Eve Family Dinner",
    description: "A festive sit-down family dinner on Christmas Eve.",
    category: "events",
    subcategory: "events.holiday_dinner",
    tags: ["christmas", "holiday", "dinner", "family"],
    scenario_slots: {
      headcount: intSlot("Guests", 2, 20, 8, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegetarian", "vegan", "gluten_free"], []),
    },
    template_list: [
      item("prime_rib_roast", "Prime rib roast", "food", 4, "lb", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "vegetarian"), pr("dietary", "excludes", "vegan")],
        scaling: [linear("headcount", 0.5, "up", 2)],
      }),
      item("vegetarian_main_wellington", "Vegetarian main (wellington)", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegetarian")],
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("vegan_main_roast", "Vegan roast", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("scalloped_potatoes", "Scalloped potatoes", "food", 4, "lb", ["headcount"], {
        scaling: [linear("headcount", 0.5, "up")],
      }),
      item("christmas_crackers", "Christmas crackers", "decor", 8, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("dinner_candles", "Dinner candles", "decor", 4, "count", []),
      item("eggnog", "Eggnog", "drinks", 2, "carton", ["headcount"], {
        scaling: [linear("headcount", 0.2, "up", 1)],
      }),
      item("gluten_free_dessert", "Gluten-free dessert", "food", 0, "count", ["dietary"], {
        presence: [pr("dietary", "includes", "gluten_free")],
      }),
      item("yule_log_cake", "Yule log cake", "food", 1, "cake", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "gluten_free")],
        scaling: [step("headcount", [{ up_to: 10, qty: 1 }, { up_to: null, qty: 2 }])],
      }),
    ],
  },

  {
    id: "easter-dinner-family-gathering",
    title: "Easter Dinner Family Gathering",
    description: "A midday Easter dinner with an egg hunt for the kids.",
    category: "events",
    subcategory: "events.holiday_dinner",
    tags: ["easter", "holiday", "dinner", "family", "kids"],
    scenario_slots: {
      time_of_day: enumSlot("Time of day", ["day", "night"], "day"),
      headcount: intSlot("Guests", 2, 20, 10, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegetarian", "vegan"], []),
    },
    template_list: [
      item("honey_baked_ham", "Honey-baked ham", "food", 5, "lb", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "vegetarian"), pr("dietary", "excludes", "vegan")],
        scaling: [linear("headcount", 0.5, "up", 3)],
      }),
      item("vegetarian_quiche", "Vegetarian quiche", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegetarian")],
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("vegan_stuffed_squash", "Vegan stuffed squash", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 0.3, "up", 1)],
      }),
      item("deviled_eggs", "Deviled eggs", "food", 12, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("easter_egg_hunt_kit", "Easter egg hunt kit", "party-favors", 1, "set", []),
      item("spring_flower_centerpiece", "Spring flower centerpiece", "decor", 1, "count", []),
      item("dinner_rolls", "Dinner rolls", "food", 10, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 10, qty: 10 }, { up_to: 20, qty: 20 }, { up_to: null, qty: 30 }])],
      }),
      item("carrot_cake", "Carrot cake", "food", 1, "cake", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 10, qty: 1 }, { up_to: null, qty: 2 }])],
      }),
    ],
  },

  {
    id: "super-bowl-watch-party",
    title: "Super Bowl Watch Party",
    description: "Hosting friends to watch the big game at home.",
    category: "events",
    subcategory: "events.game_watch_party",
    tags: ["football", "watch-party", "game-day", "sports"],
    scenario_slots: {
      headcount: intSlot("Guests", 2, 40, 12, "guests"),
      setting: enumSlot("Setting", ["indoor", "mixed"], "indoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegetarian", "vegan"], []),
    },
    template_list: [
      item("chicken_wings", "Chicken wings", "food", 72, "wings", ["headcount", "dietary"], {
        presence: [pr("dietary", "excludes", "vegan"), pr("dietary", "excludes", "vegetarian")],
        scaling: [linear("headcount", 6, "up")],
      }),
      item("vegetarian_wings", "Cauliflower wings", "food", 0, "wings", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegetarian")],
        scaling: [linear("headcount", 6, "up")],
      }),
      item("vegan_wings", "Vegan buffalo wings", "food", 0, "wings", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 6, "up")],
      }),
      item("chips_and_dip", "Chips and dip", "food", 3, "bag", ["headcount"], {
        scaling: [linear("headcount", 0.25, "up", 1)],
      }),
      item("beer", "Beer", "drinks", 6, "count", ["headcount"], {
        scaling: [linear("headcount", 0.5, "up")],
      }),
      item("soda_variety_pack", "Soda variety pack", "drinks", 1, "pack", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 12, qty: 1 }, { up_to: 25, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("paper_towels", "Paper towels", "gear", 2, "roll", []),
      item("folding_tv_trays", "Folding TV trays", "gear", 4, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 8, qty: 4 }, { up_to: 20, qty: 8 }, { up_to: null, qty: 12 }])],
      }),
    ],
  },

  {
    id: "march-madness-bracket-night",
    title: "March Madness Bracket Night",
    description: "A casual bracket-filling get-together for the tournament's opening round.",
    category: "events",
    subcategory: "events.game_watch_party",
    tags: ["basketball", "watch-party", "bracket", "sports"],
    scenario_slots: {
      headcount: intSlot("Guests", 2, 30, 10, "guests"),
      setting: enumSlot("Setting", ["indoor", "mixed"], "indoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegan"], []),
    },
    template_list: [
      item("pizza", "Pizza", "food", 4, "pizza", ["headcount"], {
        scaling: [linear("headcount", 0.375, "up")],
      }),
      item("printed_bracket_sheets", "Printed bracket sheets", "party-favors", 10, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("nachos_platter", "Nachos platter", "food", 2, "platter", ["headcount"], {
        scaling: [linear("headcount", 0.2, "up", 1)],
      }),
      item("vegan_nacho_cheese", "Vegan nacho cheese", "food", 0, "jar", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 0.1, "up", 1)],
      }),
      item("assorted_soda", "Assorted soda", "drinks", 1, "pack", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 10, qty: 1 }, { up_to: 20, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("prize_for_winner", "Prize for bracket winner", "party-favors", 1, "count", []),
      item("poster_board_for_bracket", "Poster board for group bracket", "party-favors", 1, "count", []),
    ],
  },

  {
    id: "friendsgiving-potluck",
    title: "Friendsgiving Potluck",
    description: "A potluck-style Thanksgiving with friends, where the host handles the main and everyone else brings a dish.",
    category: "events",
    subcategory: "events.potluck_dinner_party",
    tags: ["friendsgiving", "potluck", "thanksgiving", "friends"],
    scenario_slots: {
      headcount: intSlot("Guests", 4, 25, 12, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegan", "vegetarian"], []),
    },
    template_list: [
      item("disposable_serving_trays", "Disposable serving trays", "gear", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 0.3, "up", 2)],
      }),
      item("dish_name_tags", "Dish name/allergen tags", "gear", 12, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("host_main_turkey_or_ham", "Host's main (turkey or ham)", "food", 1, "count", ["dietary"], {
        presence: [pr("dietary", "excludes", "vegan"), pr("dietary", "excludes", "vegetarian")],
      }),
      item("host_vegan_main", "Host's vegan main", "food", 1, "count", ["dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
      }),
      item("folding_tables", "Folding tables", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 8, qty: 1 }, { up_to: 16, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("beverage_napkins", "Beverage napkins", "gear", 20, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 12, qty: 20 }, { up_to: 25, qty: 40 }, { up_to: null, qty: 60 }])],
      }),
      item("centerpiece_candles", "Centerpiece candles", "decor", 2, "count", []),
    ],
  },

  {
    id: "sit-down-dinner-party-for-eight",
    title: "Sit-Down Dinner Party for Eight",
    description: "A hosted, multi-course dinner party for a small group.",
    category: "events",
    subcategory: "events.potluck_dinner_party",
    tags: ["dinner-party", "hosting", "multi-course"],
    scenario_slots: {
      headcount: intSlot("Guests", 2, 12, 8, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegetarian", "gluten_free"], []),
    },
    template_list: [
      item("wine_pairing", "Wine for pairing", "drinks", 3, "bottle", ["headcount"], {
        scaling: [linear("headcount", 0.33, "up", 1)],
      }),
      item("cloth_napkins", "Cloth napkins", "gear", 8, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("place_cards", "Place cards", "decor", 8, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("appetizer_course_ingredients", "Appetizer course ingredients", "food", 1, "set", []),
      item("main_course_ingredients", "Main course ingredients", "food", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 0.125, "up", 1)],
      }),
      item("dessert_course_ingredients", "Dessert course ingredients", "food", 1, "set", []),
      item("vegetarian_main_substitute", "Vegetarian main substitute", "food", 0, "count", ["dietary"], {
        presence: [pr("dietary", "includes", "vegetarian")],
      }),
      item("gluten_free_bread", "Gluten-free bread", "food", 0, "loaf", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "gluten_free")],
        scaling: [linear("headcount", 0.1, "up", 1)],
      }),
      item("candles_and_centerpiece", "Candles and centerpiece", "decor", 1, "set", []),
    ],
  },

  // ============================== TRAVEL ===================================

  {
    id: "weekend-mountain-cabin-retreat",
    title: "Weekend Mountain Cabin Retreat",
    description: "A cozy weekend away at a rented mountain cabin.",
    category: "travel",
    subcategory: "travel.weekend_trip",
    tags: ["cabin", "mountains", "weekend", "cozy"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 8, 4, "travelers"),
      duration: durationSlot("Trip length", 14, { unit: "days", count: 3 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", [], []),
    },
    template_list: [
      item("firewood_bundle", "Firewood bundle", "gear", 3, "bundle", ["headcount", "duration"], {
        scaling: [linear("headcount", 0.5, "up"), linear("duration", 0.5, "up")],
        notes: "Additive: 0.5 bundle per traveler + 0.5 bundle per day.",
      }),
      item("hiking_boots", "Hiking boots", "apparel", 4, "pair", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("trail_snacks", "Trail snacks", "food", 11, "bars", ["headcount", "duration"], {
        scaling: [linear("headcount", 2, "up"), linear("duration", 1, "up")],
        notes: "Additive: 2 bars per traveler + 1 per day.",
      }),
      item("cabin_rental_confirmation_printout", "Cabin rental confirmation printout", "documents", 1, "count", []),
      item("board_games", "Board games", "gear", 2, "count", []),
      item("bug_spray", "Bug spray", "toiletries", 1, "bottle", []),
      item("warm_layers", "Warm layers", "apparel", 4, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "girls-weekend-trip",
    title: "Girls' Weekend Trip",
    description: "A short getaway with friends -- part relaxation, part night out.",
    category: "travel",
    subcategory: "travel.weekend_trip",
    tags: ["friends", "weekend", "girls-trip"],
    scenario_slots: {
      headcount: intSlot("Travelers", 2, 10, 5, "travelers"),
      duration: durationSlot("Trip length", 7, { unit: "days", count: 2 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", [], []),
    },
    template_list: [
      item("going_out_outfits", "Going-out outfits", "apparel", 5, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
        notes: "Genuinely multiplicative with duration in theory; per README guidance, dominant slot (headcount) scales, typical trip length folded into the constant.",
      }),
      item("phone_charger", "Phone charger", "electronics", 1, "count", []),
      item("travel_size_toiletries", "Travel-size toiletries", "toiletries", 5, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("champagne_for_toast", "Champagne for a toast", "drinks", 1, "bottle", ["headcount"], {
        scaling: [linear("headcount", 0.2, "up", 1)],
      }),
      item("shared_playlist_speaker", "Portable speaker", "electronics", 1, "count", []),
      item("snacks_for_road", "Snacks for the road", "food", 12, "count", ["headcount", "duration"], {
        scaling: [linear("headcount", 2, "up"), linear("duration", 1, "up")],
      }),
      item("matching_pajamas", "Matching pajamas set", "apparel", 0, "set", ["headcount", "budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "car-camping-weekend",
    title: "Car Camping Weekend",
    description: "A drive-up campsite weekend with the comfort of packing straight from the car.",
    category: "travel",
    subcategory: "travel.camping_backpacking",
    tags: ["camping", "outdoors", "weekend"],
    scenario_slots: {
      headcount: intSlot("Campers", 1, 10, 4, "campers"),
      duration: durationSlot("Trip length", 10, { unit: "days", count: 2 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegan", "vegetarian"], []),
    },
    template_list: [
      item("tent", "Tent", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 2, qty: 1 }, { up_to: 4, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("sleeping_bags", "Sleeping bags", "gear", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("camp_stove_fuel", "Camp stove fuel canister", "gear", 1, "canister", ["duration"], {
        scaling: [linear("duration", 0.3, "up", 1)],
      }),
      item("firewood_bundle", "Firewood bundle", "gear", 1, "bundle", ["duration"], {
        scaling: [linear("duration", 1, "up")],
      }),
      item("trail_mix", "Trail mix", "food", 6, "bags", ["headcount", "duration"], {
        scaling: [linear("headcount", 1, "up"), linear("duration", 1, "up")],
      }),
      item("bear_proof_food_container", "Bear-proof food container", "gear", 1, "count", []),
      item("portable_water_filter", "Portable water filter", "gear", 1, "count", []),
      item("vegan_camp_meals", "Vegan camp meals", "food", 0, "meals", ["headcount", "duration", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 1, "up"), linear("duration", 1, "up")],
      }),
    ],
  },

  {
    id: "3-day-backpacking-trip",
    title: "3-Day Backpacking Trip",
    description: "A lightweight, multi-day backpacking trip with everything carried in.",
    category: "travel",
    subcategory: "travel.camping_backpacking",
    tags: ["backpacking", "hiking", "multi-day", "lightweight"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 6, 2, "travelers"),
      duration: durationSlot("Trip length", 14, { unit: "days", count: 3 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["vegan"], []),
    },
    template_list: [
      item("backpacking_backpack", "Backpacking backpack", "gear", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("freeze_dried_meals", "Freeze-dried meals", "food", 8, "meals", ["headcount", "duration", "dietary"], {
        presence: [pr("dietary", "excludes", "vegan")],
        scaling: [linear("headcount", 2, "up"), linear("duration", 1, "up")],
      }),
      item("vegan_freeze_dried_meals", "Vegan freeze-dried meals", "food", 0, "meals", ["headcount", "duration", "dietary"], {
        presence: [pr("dietary", "includes", "vegan")],
        scaling: [linear("headcount", 2, "up"), linear("duration", 1, "up")],
      }),
      item("water_purification_tablets", "Water purification tablets", "gear", 6, "tablets", ["duration"], {
        scaling: [linear("duration", 2, "up")],
      }),
      item("lightweight_tent", "Lightweight tent", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 2, qty: 1 }, { up_to: 4, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("headlamp", "Headlamp", "gear", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("first_aid_kit", "First aid kit", "gear", 1, "count", []),
    ],
  },

  {
    id: "family-camping-trip-at-a-campground",
    title: "Family Camping Trip at a Campground",
    description: "A kid-friendly camping trip at a developed campground.",
    category: "travel",
    subcategory: "travel.camping_backpacking",
    tags: ["camping", "family", "kids", "campground"],
    scenario_slots: {
      headcount: intSlot("Campers", 2, 12, 5, "campers"),
      duration: durationSlot("Trip length", 14, { unit: "days", count: 3 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["nut_free"], []),
    },
    template_list: [
      item("family_tent", "Family tent", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 4, qty: 1 }, { up_to: 8, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("sleeping_bags", "Sleeping bags", "gear", 5, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("marshmallows_and_smores_kit", "S'mores kit", "food", 1, "kit", ["headcount"], {
        scaling: [linear("headcount", 0.2, "up", 1)],
      }),
      item("kid_friendly_camp_games", "Kid-friendly camp games", "gear", 2, "count", []),
      item("cooler", "Cooler", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 6, qty: 1 }, { up_to: 10, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("bug_spray_family_size", "Bug spray (family size)", "toiletries", 1, "bottle", []),
      item("nut_free_snacks", "Nut-free snacks", "food", 0, "bags", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "nut_free")],
        scaling: [linear("headcount", 0.5, "up", 1)],
      }),
    ],
  },

  {
    id: "week-long-beach-vacation",
    title: "Week-Long Beach Vacation",
    description: "A full week at the beach with a rental house or condo.",
    category: "travel",
    subcategory: "travel.beach_vacation",
    tags: ["beach", "vacation", "summer", "week-long"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 8, 4, "travelers"),
      duration: durationSlot("Trip length", 21, { unit: "days", count: 7 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", [], []),
    },
    template_list: [
      item("sunscreen", "Sunscreen", "toiletries", 3.5, "bottle", ["duration"], {
        scaling: [linear("duration", 0.5, "up", 1)],
      }),
      item("swimsuits", "Swimsuits", "apparel", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("beach_towels", "Beach towels", "gear", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("beach_umbrella", "Beach umbrella", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 4, qty: 1 }, { up_to: 8, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("cooler", "Cooler", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 4, qty: 1 }, { up_to: 8, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("snorkel_gear", "Snorkel gear", "gear", 0, "set", ["headcount", "budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
        scaling: [linear("headcount", 1, "up")],
      }),
      item("flip_flops", "Flip flops", "apparel", 4, "pair", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "long-weekend-beach-trip",
    title: "Long Weekend Beach Trip",
    description: "A quick 3-day escape to the coast.",
    category: "travel",
    subcategory: "travel.beach_vacation",
    tags: ["beach", "weekend", "short-trip"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 6, 2, "travelers"),
      duration: durationSlot("Trip length", 10, { unit: "days", count: 3 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", [], []),
    },
    template_list: [
      item("sunscreen", "Sunscreen", "toiletries", 1.5, "bottle", ["duration"], {
        scaling: [linear("duration", 0.5, "up", 1)],
      }),
      item("beach_chairs", "Beach chairs", "gear", 2, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 2, qty: 2 }, { up_to: 4, qty: 4 }, { up_to: null, qty: 6 }])],
      }),
      item("beach_bag", "Beach bag", "gear", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("cold_drinks_cooler", "Small cooler for cold drinks", "gear", 1, "count", []),
      item("beach_read_book", "Beach read (book)", "leisure", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("waterproof_phone_pouch", "Waterproof phone pouch", "gear", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "weekend-ski-trip",
    title: "Weekend Ski Trip",
    description: "A two-day ski trip to a nearby resort.",
    category: "travel",
    subcategory: "travel.ski_snow_trip",
    tags: ["ski", "snow", "weekend", "resort"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 8, 4, "travelers"),
      duration: durationSlot("Trip length", 7, { unit: "days", count: 2 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", [], []),
    },
    template_list: [
      item("lift_tickets", "Lift tickets", "activities", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("ski_rental_or_gear", "Ski/snowboard rental", "gear", 4, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("hand_warmers", "Hand warmers", "gear", 6, "pairs", ["headcount", "duration"], {
        scaling: [linear("headcount", 1, "up"), linear("duration", 1, "up")],
      }),
      item("thermal_base_layers", "Thermal base layers", "apparel", 4, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("hot_cocoa_supplies", "Hot cocoa supplies", "food", 1, "set", []),
      item("ski_wax", "Premium ski wax", "gear", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("first_aid_kit", "First aid kit", "gear", 1, "count", []),
    ],
  },

  {
    id: "week-long-snowboarding-trip",
    title: "Week-Long Snowboarding Trip",
    description: "A full week at a mountain resort focused on snowboarding.",
    category: "travel",
    subcategory: "travel.ski_snow_trip",
    tags: ["snowboarding", "ski", "resort", "week-long"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 6, 3, "travelers"),
      duration: durationSlot("Trip length", 14, { unit: "days", count: 7 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", [], []),
    },
    template_list: [
      item("lift_tickets", "Lift tickets (week pass)", "activities", 3, "passes", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
        notes: "Genuinely per-person-per-day, but per README guidance a typical 7-day week is folded into the constant (1 week-pass per traveler) rather than multiplying headcount x duration.",
      }),
      item("snowboard_rental", "Snowboard rental", "gear", 3, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("goggles", "Goggles", "gear", 3, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("hand_warmers", "Hand warmers", "gear", 10, "pairs", ["headcount", "duration"], {
        scaling: [linear("headcount", 1, "up"), linear("duration", 1, "up")],
      }),
      item("thermal_base_layers", "Thermal base layers", "apparel", 6, "sets", ["headcount"], {
        scaling: [linear("headcount", 2, "up")],
      }),
      item("trail_snacks", "Trail snacks", "food", 13, "bars", ["headcount", "duration"], {
        scaling: [linear("headcount", 1, "up"), linear("duration", 1, "up")],
      }),
    ],
  },

  {
    id: "two-day-business-trip-with-client-dinner",
    title: "Two-Day Business Trip with Client Dinner",
    description: "A short business trip that includes a client dinner requiring business-formal attire.",
    category: "travel",
    subcategory: "travel.business_trip",
    tags: ["business", "work-trip", "client-dinner"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 4, 1, "travelers"),
      duration: durationSlot("Trip length", 5, { unit: "days", count: 2 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("business_attire", "Business attire", "apparel", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("laptop_charger", "Laptop charger", "electronics", 1, "count", []),
      item("business_cards", "Business cards", "documents", 50, "count", ["headcount"], {
        scaling: [linear("headcount", 50, "up")],
      }),
      item("travel_toiletries_kit", "Travel toiletries kit", "toiletries", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("dress_shoes", "Dress shoes", "apparel", 1, "pair", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("portable_luggage_scale", "Portable luggage scale", "gear", 1, "count", []),
    ],
  },

  {
    id: "multi-city-conference-trip",
    title: "Multi-City Conference Trip",
    description: "A multi-day conference trip involving travel between cities.",
    category: "travel",
    subcategory: "travel.business_trip",
    tags: ["business", "conference", "multi-city"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 4, 1, "travelers"),
      duration: durationSlot("Trip length", 10, { unit: "days", count: 4 }),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("conference_badge_holder", "Conference badge holder", "gear", 1, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("portable_charger", "Portable charger", "electronics", 1, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("business_casual_outfits", "Business casual outfits", "apparel", 5, "count", ["headcount", "duration"], {
        scaling: [linear("headcount", 1, "up"), linear("duration", 0.3, "up")],
        notes: "Additive: 1 base outfit per traveler + a bit more per extra conference day.",
      }),
      item("noise_cancelling_headphones", "Noise-cancelling headphones", "electronics", 0, "count", ["headcount", "budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
        scaling: [linear("headcount", 1, "up")],
      }),
      item("travel_size_toiletries", "Travel-size toiletries", "toiletries", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("printed_itinerary", "Printed itinerary", "documents", 1, "count", []),
    ],
  },

  // =============================== HOME ====================================

  {
    id: "studio-apartment-starter-kit",
    title: "Studio Apartment Starter Kit",
    description: "Essentials for setting up a small studio apartment where every item needs to earn its space.",
    category: "home",
    subcategory: "home.new_apartment_setup",
    tags: ["studio", "move-in", "small-space"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("shower_curtain_and_rings", "Shower curtain and rings", "bathroom", 1, "set", []),
      item("basic_bedding_set", "Basic bedding set", "bedroom", 1, "set", []),
      item("foldable_furniture_set", "Foldable/multi-use furniture set", "furniture", 1, "set", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "low")],
      }),
      item("premium_space_saving_furniture", "Premium space-saving furniture", "furniture", 1, "set", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("command_hooks_organizers", "Command hooks and organizers", "storage", 1, "set", []),
      item("microwave", "Microwave", "kitchen", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("hot_plate", "Hot plate", "kitchen", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "low")],
      }),
      item("trash_cans", "Trash cans", "cleaning", 2, "count", []),
    ],
  },

  {
    id: "moving-into-a-new-house",
    title: "Moving Into a New House",
    description: "Packing and moving supplies for relocating an entire household.",
    category: "home",
    subcategory: "home.moving_in",
    tags: ["moving", "packing", "relocation"],
    scenario_slots: {
      headcount: intSlot("Household members", 1, 8, 2, "people"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("moving_boxes", "Moving boxes", "packing", 30, "count", ["headcount"], {
        scaling: [linear("headcount", 15, "up", 10)],
      }),
      item("packing_tape", "Packing tape", "packing", 4, "roll", ["headcount"], {
        scaling: [linear("headcount", 2, "up")],
      }),
      item("bubble_wrap", "Bubble wrap", "packing", 2, "roll", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("furniture_sliders", "Furniture sliders", "gear", 1, "set", []),
      item("moving_dolly", "Moving dolly", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 3, qty: 1 }, { up_to: null, qty: 2 }])],
      }),
      item("box_cutter", "Box cutter", "gear", 2, "count", []),
      item("address_change_kit", "Address change kit", "documents", 1, "count", []),
      item("premium_moving_insurance", "Premium moving insurance", "services", 0, "policy", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
    ],
  },

  {
    id: "moving-in-with-a-partner",
    title: "Moving In With a Partner",
    description: "Combining two households into one shared home.",
    category: "home",
    subcategory: "home.moving_in",
    tags: ["moving", "cohabitation", "couples"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("shared_bedding_set", "Shared bedding set", "bedroom", 1, "set", []),
      item("duplicate_item_donation_box", "Box for duplicate kitchen items to donate", "packing", 1, "count", []),
      item("matching_towel_set", "Matching towel set", "bathroom", 1, "set", []),
      item("shared_grocery_starter_kit", "Shared pantry starter kit", "kitchen", 1, "set", []),
      item("moving_boxes", "Moving boxes", "packing", 20, "count", []),
      item("label_maker", "Label maker", "gear", 1, "count", []),
      item("premium_furniture_upgrade", "Premium shared furniture upgrade", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
    ],
  },

  {
    id: "setting-up-a-nursery",
    title: "Setting Up a Nursery",
    description: "Furnishing and stocking a nursery for a new baby.",
    category: "home",
    subcategory: "home.nursery_setup",
    tags: ["nursery", "baby", "newborn"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("crib", "Crib", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("budget_crib", "Budget crib", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "low")],
      }),
      item("changing_table", "Changing table", "furniture", 1, "count", []),
      item("diapers_starter_pack", "Diapers starter pack", "baby", 1, "pack", []),
      item("baby_monitor", "Baby monitor", "electronics", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("blackout_curtains", "Blackout curtains", "decor", 1, "set", []),
      item("nursery_glider_chair", "Nursery glider chair", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("crib_sheets", "Crib sheets", "bedroom", 3, "count", []),
    ],
  },

  {
    id: "nursery-on-a-budget",
    title: "Nursery on a Budget",
    description: "The essentials for a nursery without the premium extras.",
    category: "home",
    subcategory: "home.nursery_setup",
    tags: ["nursery", "baby", "budget"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "low"),
    },
    template_list: [
      item("secondhand_crib_checklist", "Secondhand crib safety checklist", "documents", 1, "count", []),
      item("diapers_starter_pack", "Diapers starter pack", "baby", 1, "pack", []),
      item("changing_pad", "Changing pad", "furniture", 1, "count", []),
      item("budget_baby_monitor", "Budget baby monitor", "electronics", 1, "count", []),
      item("basic_crib_sheets", "Basic crib sheets", "bedroom", 2, "count", []),
      item("dresser_as_changing_table_hack", "Dresser-top changing pad conversion kit", "furniture", 1, "count", []),
    ],
  },

  {
    id: "remote-work-home-office-setup",
    title: "Remote Work Home Office Setup",
    description: "Setting up a dedicated home office for full-time remote work.",
    category: "home",
    subcategory: "home.home_office_setup",
    tags: ["home-office", "remote-work", "wfh"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("ergonomic_office_chair", "Ergonomic office chair", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("basic_desk_chair", "Basic desk chair", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "low")],
      }),
      item("standing_desk", "Standing desk", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("basic_desk", "Basic desk", "furniture", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "high")],
      }),
      item("monitor", "Monitor", "electronics", 1, "count", []),
      item("webcam", "Webcam", "electronics", 1, "count", []),
      item("desk_lamp", "Desk lamp", "furniture", 1, "count", []),
      item("cable_management_kit", "Cable management kit", "gear", 1, "set", []),
    ],
  },

  {
    id: "small-home-office-in-a-bedroom-corner",
    title: "Small Home Office in a Bedroom Corner",
    description: "Carving out a functional workspace in an unused bedroom corner.",
    category: "home",
    subcategory: "home.home_office_setup",
    tags: ["home-office", "small-space", "bedroom"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("compact_corner_desk", "Compact corner desk", "furniture", 1, "count", []),
      item("room_divider_screen", "Room divider screen", "furniture", 1, "count", []),
      item("noise_cancelling_headphones", "Noise-cancelling headphones", "electronics", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("desk_lamp", "Desk lamp", "furniture", 1, "count", []),
      item("under_desk_cable_tray", "Under-desk cable tray", "gear", 1, "count", []),
      item("wall_mounted_shelving", "Wall-mounted shelving", "storage", 1, "set", []),
    ],
  },

  {
    id: "bringing-home-a-new-puppy",
    title: "Bringing Home a New Puppy",
    description: "Everything needed for a puppy's first days at home.",
    category: "home",
    subcategory: "home.pet_setup",
    tags: ["puppy", "dog", "new-pet"],
    scenario_slots: {
      headcount: intSlot("Puppies", 1, 3, 1, "puppies"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("puppy_crate", "Puppy crate", "pet", 1, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("puppy_food_starter_bag", "Puppy food starter bag", "pet", 1, "bag", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("leash_and_collar", "Leash and collar", "pet", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("puppy_pads", "Puppy pads", "pet", 1, "pack", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("chew_toys", "Chew toys", "pet", 3, "count", ["headcount"], {
        scaling: [linear("headcount", 3, "up")],
      }),
      item("puppy_training_treats", "Puppy training treats", "pet", 1, "bag", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("premium_orthopedic_bed", "Premium orthopedic bed", "pet", 0, "count", ["headcount", "budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "new-cat-starter-kit",
    title: "New Cat Starter Kit",
    description: "Setting up the house for a newly adopted cat.",
    category: "home",
    subcategory: "home.pet_setup",
    tags: ["cat", "new-pet", "adoption"],
    scenario_slots: {
      headcount: intSlot("Cats", 1, 4, 1, "cats"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("litter_box", "Litter box", "pet", 1, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("cat_litter", "Cat litter", "pet", 1, "bag", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("scratching_post", "Scratching post", "pet", 1, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("cat_food_starter_bag", "Cat food starter bag", "pet", 1, "bag", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("cat_carrier", "Cat carrier", "pet", 1, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("premium_cat_tree", "Premium cat tree", "pet", 0, "count", ["headcount", "budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "college-dorm-move-in-essentials",
    title: "College Dorm Move-In Essentials",
    description: "The essentials for moving into a college dorm room.",
    category: "home",
    subcategory: "home.dorm_move_in",
    tags: ["dorm", "college", "move-in"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("twin_xl_bedding", "Twin XL bedding", "bedroom", 1, "set", []),
      item("mini_fridge", "Mini fridge", "kitchen", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("shower_caddy", "Shower caddy", "bathroom", 1, "count", []),
      item("desk_organizer", "Desk organizer", "storage", 1, "count", []),
      item("command_strips", "Command strips", "gear", 1, "pack", []),
      item("laundry_bag", "Laundry bag", "gear", 1, "count", []),
      item("noise_cancelling_earplugs", "Earplugs", "gear", 1, "pack", []),
      item("microwave", "Microwave", "kitchen", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
    ],
  },

  {
    id: "dorm-room-essentials-for-a-shared-room",
    title: "Dorm Room Essentials for a Shared Room",
    description: "Essentials for a dorm room shared with one or more roommates.",
    category: "home",
    subcategory: "home.dorm_move_in",
    tags: ["dorm", "college", "roommates"],
    scenario_slots: {
      headcount: intSlot("Roommates", 1, 4, 2, "roommates"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("bunkable_bed_risers", "Bed risers", "furniture", 1, "set", []),
      item("shared_mini_fridge", "Shared mini fridge", "kitchen", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("room_divider_curtain", "Room divider curtain", "furniture", 1, "count", []),
      item("labeled_storage_bins", "Labeled storage bins", "storage", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("shared_cleaning_supplies_caddy", "Shared cleaning supplies caddy", "cleaning", 1, "set", []),
      item("individual_desk_lamps", "Individual desk lamps", "furniture", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  // ============================= SEASONAL ==================================

  {
    id: "back-to-school-shopping-elementary-kids",
    title: "Back to School Shopping for Elementary Kids",
    description: "Getting elementary-age kids ready for the first day of school.",
    category: "seasonal",
    subcategory: "seasonal.back_to_school",
    tags: ["school", "kids", "elementary", "fall"],
    scenario_slots: {
      headcount: intSlot("Kids", 1, 5, 2, "kids"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("backpacks", "Backpacks", "school", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("school_supply_bundle", "School supply bundle", "school", 2, "set", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("lunch_boxes", "Lunch boxes", "school", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("labeled_water_bottles", "Labeled water bottles", "school", 2, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("new_sneakers", "New sneakers", "apparel", 2, "pair", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("premium_backpack_upgrade", "Premium backpack upgrade", "school", 0, "count", ["headcount", "budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
        scaling: [linear("headcount", 1, "up")],
      }),
    ],
  },

  {
    id: "college-move-in-school-supplies",
    title: "College Move-In School Supplies",
    description: "Academic supplies for the start of a college semester.",
    category: "seasonal",
    subcategory: "seasonal.back_to_school",
    tags: ["school", "college", "move-in", "fall"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("notebooks_and_binders", "Notebooks and binders", "school", 1, "set", []),
      item("laptop_backpack", "Laptop backpack", "school", 1, "count", []),
      item("graphing_calculator", "Graphing calculator", "school", 1, "count", []),
      item("desk_supplies_organizer", "Desk supplies organizer", "school", 1, "count", []),
      item("textbook_budget_set", "Used textbook bundle", "school", 0, "set", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "low")],
      }),
      item("new_laptop", "New laptop", "electronics", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
    ],
  },

  {
    id: "prepping-to-host-christmas",
    title: "Prepping to Host Christmas",
    description: "Getting the house decorated and stocked to host family for Christmas.",
    category: "seasonal",
    subcategory: "seasonal.holiday_hosting",
    tags: ["christmas", "hosting", "holiday", "winter"],
    scenario_slots: {
      headcount: intSlot("Expected guests", 4, 25, 12, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["gluten_free"], []),
    },
    template_list: [
      item("christmas_tree", "Christmas tree", "decor", 1, "count", []),
      item("string_lights_indoor", "Indoor string lights", "decor", 2, "set", []),
      item("stockings", "Stockings", "decor", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 0.5, "up", 2)],
      }),
      item("holiday_tablecloth", "Holiday tablecloth", "decor", 1, "count", []),
      item("guest_bedding_for_overnight_family", "Guest bedding sets", "bedroom", 1, "set", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 8, qty: 1 }, { up_to: 16, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("christmas_cookies_ingredients", "Christmas cookie ingredients", "food", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 0.1, "up", 1)],
      }),
      item("gluten_free_cookie_mix", "Gluten-free cookie mix", "food", 0, "box", ["dietary"], {
        presence: [pr("dietary", "includes", "gluten_free")],
      }),
    ],
  },

  {
    id: "hanukkah-hosting-prep",
    title: "Hanukkah Hosting Prep",
    description: "Prepping to host a Hanukkah celebration with latkes and candle-lighting.",
    category: "seasonal",
    subcategory: "seasonal.holiday_hosting",
    tags: ["hanukkah", "hosting", "holiday", "winter"],
    scenario_slots: {
      headcount: intSlot("Expected guests", 4, 20, 10, "guests"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Dietary needs", ["gluten_free"], []),
    },
    template_list: [
      item("menorah_and_candles", "Menorah and candles", "decor", 1, "set", []),
      item("potato_latke_ingredients", "Potato latke ingredients", "food", 1, "set", ["headcount"], {
        scaling: [linear("headcount", 0.15, "up", 1)],
      }),
      item("dreidels_and_gelt", "Dreidels and gelt", "party-favors", 10, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("applesauce", "Applesauce", "food", 2, "jar", ["headcount"], {
        scaling: [linear("headcount", 0.2, "up", 1)],
      }),
      item("gluten_free_latke_mix", "Gluten-free latke mix", "food", 0, "box", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "gluten_free")],
        scaling: [linear("headcount", 0.1, "up", 1)],
      }),
      item("hanukkah_napkins", "Hanukkah-themed napkins", "gear", 20, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 10, qty: 20 }, { up_to: 20, qty: 40 }, { up_to: null, qty: 60 }])],
      }),
    ],
  },

  {
    id: "trick-or-treat-hosting",
    title: "Trick-or-Treat Hosting",
    description: "Stocking up to hand out candy and decorate the porch for trick-or-treaters.",
    category: "seasonal",
    subcategory: "seasonal.halloween",
    tags: ["halloween", "trick-or-treat", "candy", "fall"],
    scenario_slots: {
      headcount: intSlot("Expected trick-or-treaters", 10, 300, 60, "trick-or-treaters"),
      setting: enumSlot("Setting", ["outdoor", "indoor"], "outdoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      dietary: tagListSlot("Allergy notes", ["nut_free"], []),
    },
    template_list: [
      item("candy_bulk_bag", "Candy (bulk bag)", "food", 3, "lb", ["headcount"], {
        scaling: [linear("headcount", 0.05, "up", 1)],
      }),
      item("pumpkin_carving_kit", "Pumpkin carving kit", "decor", 2, "count", []),
      item("porch_lights_orange", "Orange porch lights", "decor", 1, "set", ["setting"], {
        presence: [pr("setting", "equals", "outdoor")],
      }),
      item("non_food_treats", "Non-food treats (allergy-friendly)", "food", 0, "count", ["headcount", "dietary"], {
        presence: [pr("dietary", "includes", "nut_free")],
        scaling: [linear("headcount", 0.1, "up", 1)],
      }),
      item("halloween_door_decor", "Halloween door decor", "decor", 1, "set", []),
    ],
  },

  {
    id: "halloween-party-decor-and-setup",
    title: "Halloween Party Decor and Setup",
    description: "Decorating and stocking up for a hosted Halloween party.",
    category: "seasonal",
    subcategory: "seasonal.halloween",
    tags: ["halloween", "party", "decor", "fall"],
    scenario_slots: {
      headcount: intSlot("Guests", 5, 40, 15, "guests"),
      setting: enumSlot("Setting", ["indoor", "outdoor", "mixed"], "indoor"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("spooky_string_lights", "Spooky string lights", "decor", 2, "set", []),
      item("fog_machine", "Fog machine", "decor", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("halloween_tablecloth", "Halloween tablecloth", "decor", 1, "count", []),
      item("fake_spiderwebs", "Fake spiderwebs", "decor", 3, "count", []),
      item("halloween_themed_cups", "Halloween-themed cups", "gear", 15, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 15, qty: 15 }, { up_to: 30, qty: 30 }, { up_to: null, qty: 50 }])],
      }),
      item("costume_contest_prize", "Costume contest prize", "party-favors", 1, "count", []),
      item("jack_o_lanterns", "Jack-o'-lanterns", "decor", 2, "count", ["setting"], {
        presence: [pr("setting", "not_equals", "indoor")],
        notes: "Present for outdoor or mixed settings -- 'not_equals indoor' covers both with a single condition.",
      }),
    ],
  },

  {
    id: "hurricane-season-prep-kit",
    title: "Hurricane Season Prep Kit",
    description: "Assembling an emergency kit ahead of hurricane season.",
    category: "seasonal",
    subcategory: "seasonal.severe_weather_prep",
    tags: ["hurricane", "emergency", "severe-weather", "prep"],
    scenario_slots: {
      headcount: intSlot("Household members", 1, 8, 4, "people"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("bottled_water", "Bottled water", "emergency", 12, "gallons", ["headcount"], {
        scaling: [linear("headcount", 3, "up", 3)],
        notes: "3-day supply at 1 gallon/person/day.",
      }),
      item("non_perishable_food", "Non-perishable food", "emergency", 36, "meals", ["headcount"], {
        scaling: [linear("headcount", 9, "up")],
      }),
      item("flashlights", "Flashlights", "emergency", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("batteries", "Batteries", "emergency", 8, "count", ["headcount"], {
        scaling: [linear("headcount", 2, "up")],
      }),
      item("portable_generator", "Portable generator", "emergency", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "equals", "high")],
      }),
      item("battery_powered_radio", "Battery-powered radio", "emergency", 1, "count", []),
      item("first_aid_kit", "First aid kit", "emergency", 1, "count", []),
      item("window_storm_shutters_or_plywood", "Window storm shutters/plywood", "emergency", 1, "set", []),
    ],
  },

  {
    id: "winter-storm-emergency-kit",
    title: "Winter Storm Emergency Kit",
    description: "Prepping the home and car for winter storms and potential power outages.",
    category: "seasonal",
    subcategory: "seasonal.severe_weather_prep",
    tags: ["winter", "storm", "emergency", "prep"],
    scenario_slots: {
      headcount: intSlot("Household members", 1, 8, 4, "people"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("emergency_blankets", "Emergency blankets", "emergency", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("portable_car_battery_jump_starter", "Portable car battery jump starter", "emergency", 1, "count", []),
      item("ice_melt_bags", "Ice melt bags", "emergency", 2, "bag", []),
      item("snow_shovel", "Snow shovel", "emergency", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 4, qty: 1 }, { up_to: null, qty: 2 }])],
      }),
      item("non_perishable_food", "Non-perishable food", "emergency", 36, "meals", ["headcount"], {
        scaling: [linear("headcount", 9, "up")],
      }),
      item("flashlights", "Flashlights", "emergency", 4, "count", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("backup_phone_battery_pack", "Backup phone battery pack", "electronics", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
    ],
  },

  {
    id: "starting-a-spring-vegetable-garden",
    title: "Starting a Spring Vegetable Garden",
    description: "Getting set up to plant a home vegetable garden this spring.",
    category: "seasonal",
    subcategory: "seasonal.gardening_planting",
    tags: ["gardening", "spring", "vegetables", "planting"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
      garden_size: enumSlot("Garden size", ["small", "medium", "large"], "medium"),
    },
    template_list: [
      item("starter_seed_packets", "Starter seed packets (small garden)", "garden", 1, "set", ["garden_size"], {
        presence: [pr("garden_size", "equals", "small")],
      }),
      item("standard_seed_packet_set", "Standard seed packet set", "garden", 1, "set", ["garden_size"], {
        presence: [pr("garden_size", "equals", "medium")],
      }),
      item("expanded_seed_packet_set", "Expanded seed packet set", "garden", 1, "set", ["garden_size"], {
        presence: [pr("garden_size", "equals", "large")],
      }),
      item("potting_soil", "Potting soil", "garden", 2, "bag", []),
      item("garden_gloves", "Garden gloves", "garden", 2, "pair", []),
      item("trowel_and_hand_tools", "Trowel and hand tools", "garden", 1, "set", []),
      item("watering_can", "Watering can", "garden", 1, "count", []),
      item("organic_fertilizer", "Organic fertilizer", "garden", 0, "bag", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("raised_garden_bed_kit", "Raised garden bed kit", "garden", 0, "count", ["garden_size"], {
        presence: [pr("garden_size", "equals", "large")],
      }),
    ],
  },

  {
    id: "planting-a-fall-garden",
    title: "Planting a Fall Garden",
    description: "Getting cool-weather crops and bulbs into the ground for fall.",
    category: "seasonal",
    subcategory: "seasonal.gardening_planting",
    tags: ["gardening", "fall", "planting", "bulbs"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("fall_vegetable_seeds", "Fall vegetable seeds (kale, garlic, spinach)", "garden", 1, "set", []),
      item("frost_cloth_row_cover", "Frost cloth row cover", "garden", 1, "count", []),
      item("garden_gloves", "Garden gloves", "garden", 2, "pair", []),
      item("compost", "Compost", "garden", 0, "bag", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("bulb_planting_kit", "Bulb planting kit", "garden", 1, "set", []),
      item("mulch_bags", "Mulch bags", "garden", 3, "bag", []),
    ],
  },

  {
    id: "getting-the-pool-ready-for-summer",
    title: "Getting the Pool Ready for Summer",
    description: "Opening and prepping a backyard pool for the summer season.",
    category: "seasonal",
    subcategory: "seasonal.summer_prep",
    tags: ["pool", "summer", "backyard"],
    scenario_slots: {
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("pool_chemical_starter_kit", "Pool chemical starter kit", "pool", 1, "kit", []),
      item("pool_skimmer_net", "Pool skimmer net", "pool", 1, "count", []),
      item("pool_cover_removal_and_cleaning_kit", "Pool cover cleaning kit", "pool", 1, "kit", []),
      item("pool_float_set", "Pool float set", "pool", 0, "set", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("pool_filter_replacement", "Pool filter replacement", "pool", 1, "count", []),
      item("pool_test_strips", "Pool test strips", "pool", 1, "pack", []),
    ],
  },

  {
    id: "summer-road-trip-prep",
    title: "Summer Road Trip Prep",
    description: "Getting the car and family stocked up for summer road trips.",
    category: "seasonal",
    subcategory: "seasonal.summer_prep",
    tags: ["road-trip", "summer", "car", "prep"],
    scenario_slots: {
      headcount: intSlot("Travelers", 1, 7, 4, "travelers"),
      budget_tier: enumSlot("Budget", ["low", "mid", "high"], "mid"),
    },
    template_list: [
      item("car_emergency_kit", "Car emergency kit", "car", 1, "kit", []),
      item("cooler_for_car", "Cooler for the car", "gear", 1, "count", ["headcount"], {
        scaling: [step("headcount", [{ up_to: 4, qty: 1 }, { up_to: 6, qty: 2 }, { up_to: null, qty: 3 }])],
      }),
      item("sunscreen", "Sunscreen", "toiletries", 1, "bottle", ["headcount"], {
        scaling: [linear("headcount", 0.5, "up", 1)],
      }),
      item("car_phone_mount", "Car phone mount", "electronics", 1, "count", []),
      item("road_trip_snacks", "Road trip snacks", "food", 4, "bags", ["headcount"], {
        scaling: [linear("headcount", 1, "up")],
      }),
      item("portable_car_charger", "Portable car charger", "electronics", 0, "count", ["budget_tier"], {
        presence: [pr("budget_tier", "not_equals", "low")],
      }),
      item("tire_pressure_gauge", "Tire pressure gauge", "car", 1, "count", []),
    ],
  },
];

// ---- README worked examples (already schema-valid; included verbatim as   ----
// ---- the first 3 seed records so the pipeline's own worked examples ship  ----
// ---- as real content, not just documentation). Source: docs/schemas/README.md

const readmeWorkedExamples: UseCase[] = [
  {
    id: "backyard-bbq-cookout",
    title: "Backyard BBQ Cookout",
    description: "Hosting a casual grill-out for friends or family.",
    category: "events",
    subcategory: "events.bbq_grilling",
    tags: ["grilling", "summer", "outdoor"],
    scenario_slots: {
      time_of_day: { type: "enum", label: "Time of day", options: ["day", "night"], default: "day" },
      headcount: { type: "integer", label: "Guests", min: 2, max: 100, default: 8, unit: "guests" },
      setting: { type: "enum", label: "Setting", options: ["outdoor", "indoor", "mixed"], default: "outdoor" },
      budget_tier: { type: "enum", label: "Budget", options: ["low", "mid", "high"], default: "mid" },
      dietary: { type: "tag_list", label: "Dietary needs", options: ["vegetarian", "vegan", "gluten_free", "nut_free"], default: [] },
    },
    template_list: [
      { item_id: "grill_tongs", name: "Grill tongs", category: "gear", qty: { base: 1, unit: "pair" }, depends_on_slots: [] },
      {
        item_id: "charcoal_briquettes",
        name: "Charcoal briquettes",
        category: "fuel",
        qty: { base: 2.4, unit: "kg" },
        depends_on_slots: ["headcount"],
        scaling_rules: [{ slot_id: "headcount", method: "linear", per_unit: 0.3, round: "up", minimum: 1 }],
      },
      {
        item_id: "beef_burger_patties",
        name: "Beef burger patties",
        category: "food",
        qty: { base: 8, unit: "count" },
        depends_on_slots: ["headcount", "dietary"],
        presence_rules: [{ slot_id: "dietary", condition: "excludes", value: "vegan" }],
        scaling_rules: [{ slot_id: "headcount", method: "linear", per_unit: 1, round: "up" }],
      },
      {
        item_id: "veggie_burger_patties",
        name: "Veggie burger patties",
        category: "food",
        qty: { base: 0, unit: "count" },
        depends_on_slots: ["headcount", "dietary"],
        presence_rules: [{ slot_id: "dietary", condition: "includes", value: "vegan" }],
        scaling_rules: [{ slot_id: "headcount", method: "linear", per_unit: 1, round: "up" }],
        notes: "Absent by default (dietary default is []); qty.base is unused while excluded.",
      },
      {
        item_id: "folding_tables",
        name: "Folding tables",
        category: "gear",
        qty: { base: 1, unit: "count" },
        depends_on_slots: ["headcount"],
        scaling_rules: [{ slot_id: "headcount", method: "step", tiers: [{ up_to: 8, qty: 1 }, { up_to: 20, qty: 2 }, { up_to: null, qty: 3 }] }],
      },
      {
        item_id: "string_lights",
        name: "Outdoor string lights",
        category: "decor",
        qty: { base: 1, unit: "set" },
        depends_on_slots: ["time_of_day", "setting"],
        presence_rules: [
          { slot_id: "time_of_day", condition: "equals", value: "night" },
          { slot_id: "setting", condition: "equals", value: "outdoor" },
        ],
        notes: "Item affected by two slots at once (AND-combined) -- only shows up for an outdoor night BBQ.",
      },
    ],
  },
  {
    id: "weekend-trip-getaway",
    title: "Weekend Trip",
    description: "A short getaway, 2-4 days, for a couple or small group.",
    category: "travel",
    subcategory: "travel.weekend_trip",
    tags: ["packing", "short-trip"],
    scenario_slots: {
      headcount: { type: "integer", label: "Travelers", min: 1, max: 8, default: 2, unit: "travelers" },
      duration: { type: "duration", label: "Trip length", max_days: 14, default: { unit: "days", count: 3 } },
      budget_tier: { type: "enum", label: "Budget", options: ["low", "mid", "high"], default: "mid" },
      dietary: { type: "tag_list", label: "Dietary needs", default: [] },
    },
    template_list: [
      { item_id: "phone_charger", name: "Phone charger", category: "electronics", qty: { base: 1, unit: "count" }, depends_on_slots: [] },
      {
        item_id: "toothbrush",
        name: "Toothbrush",
        category: "toiletries",
        qty: { base: 2, unit: "count" },
        depends_on_slots: ["headcount"],
        scaling_rules: [{ slot_id: "headcount", method: "linear", per_unit: 1 }],
      },
      {
        item_id: "granola_bars",
        name: "Granola bars",
        category: "food",
        qty: { base: 7, unit: "bars" },
        depends_on_slots: ["headcount", "duration"],
        scaling_rules: [
          { slot_id: "headcount", method: "linear", per_unit: 2 },
          { slot_id: "duration", method: "linear", per_unit: 1 },
        ],
        notes: "Additive: 2 bars per traveler + 1 per day, not travelers x days.",
      },
    ],
  },
  {
    id: "first-apartment-essentials",
    title: "First Apartment Essentials",
    category: "home",
    subcategory: "home.new_apartment_setup",
    tags: ["move-in", "kitchen", "starter-kit"],
    scenario_slots: {
      budget_tier: { type: "enum", label: "Budget", options: ["low", "mid", "high"], default: "mid" },
    },
    template_list: [
      { item_id: "broom_and_dustpan", name: "Broom and dustpan", category: "cleaning", qty: { base: 1, unit: "set" }, depends_on_slots: [] },
      {
        item_id: "basic_cookware_set",
        name: "Basic cookware set",
        category: "kitchen",
        qty: { base: 1, unit: "set" },
        depends_on_slots: ["budget_tier"],
        presence_rules: [{ slot_id: "budget_tier", condition: "not_equals", value: "high" }],
      },
      {
        item_id: "premium_cookware_set",
        name: "Premium cookware set",
        category: "kitchen",
        qty: { base: 0, unit: "set" },
        depends_on_slots: ["budget_tier"],
        presence_rules: [{ slot_id: "budget_tier", condition: "equals", value: "high" }],
      },
    ],
  },
];

const allUseCases = [...readmeWorkedExamples, ...useCases];

// ---- run: validate -> dedup -> write -> record state --------------------

function main() {
  const logger = new Logger(LOG_FILE);
  fs.mkdirSync(SEED_DIR, { recursive: true });

  logger.log(`AUTHOR-BATCH START: ${allUseCases.length} hand-authored records to process`);

  let validCount = 0;
  let invalidCount = 0;
  const validRecords: UseCase[] = [];

  for (const uc of allUseCases) {
    const result = validateUseCase(uc);
    if (result.valid) {
      validCount++;
      validRecords.push(uc);
    } else {
      invalidCount++;
      logger.error(
        `REJECTED id=${uc.id} schemaErrors=${JSON.stringify(result.schemaErrors)} lintErrors=${JSON.stringify(result.lintErrors)}`
      );
    }
  }

  // Manual review pass: title pairs sharing common short words (e.g. "weekend
  // trip") can trip the lexical Jaccard heuristic even when the underlying
  // scenarios are genuinely distinct. Each flagged pair is logged either way
  // -- REVIEWED entries below are ones a human/agent has actually looked at
  // and confirmed are not duplicates (documented here rather than silently
  // suppressed), everything else would be excluded from the write.
  const REVIEWED_FALSE_POSITIVES = new Set<string>([
    "weekend-trip-getaway|girls-weekend-trip",
    "weekend-trip-getaway|weekend-ski-trip",
  ]);

  const candidatePool: DedupCandidate[] = validRecords.map((uc) => ({ id: uc.id, title: uc.title }));
  const flags = findNearDuplicates(candidatePool);
  const flaggedIds = new Set<string>();
  for (const flag of flags) {
    const key1 = `${flag.a.id}|${flag.b.id}`;
    const key2 = `${flag.b.id}|${flag.a.id}`;
    const reviewed = REVIEWED_FALSE_POSITIVES.has(key1) || REVIEWED_FALSE_POSITIVES.has(key2);
    logger.warn(
      `DEDUP FLAG "${flag.a.title}" (${flag.a.id}) ~ "${flag.b.title}" (${flag.b.id}) similarity=${flag.similarity.toFixed(2)}` +
        (reviewed
          ? " -- REVIEWED: false positive (short shared words 'weekend'/'trip'; scenarios are genuinely distinct), keeping both."
          : "")
    );
    if (!reviewed) {
      flaggedIds.add(flag.a.id);
      flaggedIds.add(flag.b.id);
    }
  }

  const toWrite = validRecords.filter((r) => !flaggedIds.has(r.id));
  for (const record of toWrite) {
    fs.writeFileSync(path.join(SEED_DIR, `${record.id}.json`), JSON.stringify(record, null, 2) + "\n", "utf-8");
  }

  logger.log(
    `AUTHOR-BATCH DONE: generated=${allUseCases.length} valid=${validCount} invalid=${invalidCount} dedupFlagged=${flaggedIds.size} written=${toWrite.length}`
  );

  const bySubcategory = new Map<string, UseCase[]>();
  for (const uc of toWrite) {
    if (!bySubcategory.has(uc.subcategory)) bySubcategory.set(uc.subcategory, []);
    bySubcategory.get(uc.subcategory)!.push(uc);
  }

  for (const [subcategory, records] of bySubcategory) {
    recordBatch(
      STATE_FILE,
      {
        batch_id: `hand-authored-${subcategory}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        subcategory,
        model: null,
        requested_count: records.length,
        generated_count: records.length,
        valid_count: records.length,
        invalid_count: 0,
        dedup_flagged_count: 0,
        written_count: records.length,
        source: "hand-authored",
        notes: "Initial hand-authored seed batch (no ANTHROPIC_API_KEY available in this environment); see PIPELINE_README.md.",
      },
      20
    );
  }

  if (invalidCount > 0) {
    process.exit(1);
  }
}

main();
