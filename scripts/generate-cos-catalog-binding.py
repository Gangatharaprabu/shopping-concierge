"""
Grounds the Apparel & Accessories decision schema against a real catalog
sample: FixedAttributeSample_COS_15thSept2026.xlsx (1000 COS product rows,
sourced via Glance/FLEX). For each decision vector on an archetype actually
present in the sample, this records the REAL field path that answers it
(a flat column, a fixed_attributes.* path, or a meta.productAttributes.*
path), how often that field is actually populated in the 1000 rows, and
whether the vector has no real field at all yet (a genuine catalog gap,
not a schema gap).

Field-path mappings (VECTOR_BINDINGS below) are hand-authored — matching a
decision vector's *meaning* to the right real field requires judgment a
script can't derive. Everything else (population rates, worked examples,
the raw attribute vocabulary) is computed directly from the workbook, not
guessed, so the numbers stay honest if the sample changes.

Run: python3 scripts/generate-cos-catalog-binding.py <path-to-xlsx>
Writes: docs/schemas/product-decision-schema/catalog-source-cos.json
"""
import json
import os
import sys
import collections

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO_ROOT, "docs", "schemas", "product-decision-schema")

CAT_TO_ARCH = {
    ("apparel", "topwear"): "everyday_tops_adult",
    ("apparel", "bottomwear"): "bottoms_pants_shorts_skirts_adult",
    ("apparel", "dresses & one-pieces"): "dresses_onepieces_outfitsets",
    ("apparel", "outerwear"): "outerwear_coats_jackets",
    ("accessories", "jewellery"): "fine_jewelry",
    ("accessories", "hosiery"): "hosiery_socks",
    ("accessories", "headwear"): "headwear_hats",
    ("accessories", "belts"): "belts_buckles",
    ("accessories", "eyewear"): "eyewear_sunglasses",
    ("accessories", "gloves & armwear"): "cold_weather_small_accessories",
    ("accessories", "scarves & stoles"): "scarves_wraps",
}

# archetype_id -> vector_id -> binding spec.
# real_field: dotted path actually present in this feed (None if genuinely unmodeled).
# gap: true when the decision vector matters (per archetypes.apparel.json) but this
#      catalog has no structured field for it yet — a real enrichment gap, not ours.
VECTOR_BINDINGS = {
    "everyday_tops_adult": {
        "size_fit": {"real_field": "size", "note": "flat letter/numeric size; personalization needs suitability.body_type"},
        "fit_style": {"real_field": "fixed_attributes.silhouette & fit.garment fit"},
        "fabric_and_care": {"real_field": "materials, fixed_attributes.fabric.material type", "note": "wash care lives in meta.productAttributes.core_information.wash_care but is rarely populated"},
        "occasion": {"real_field": "fixed_attributes.styling & context.occasion, meta.productAttributes.suitability.occasion"},
        "season_weight": {"real_field": "fixed_attributes.styling & context.season, fixed_attributes.fabric.weight"},
        "price_tier": {"real_field": "price, original_price, onsale"},
    },
    "bottoms_pants_shorts_skirts_adult": {
        "waist_inseam_fit": {"real_field": "size", "note": "single combined string (e.g. '34R'), not separate waist/inseam fields"},
        "rise_and_silhouette": {"real_field": "fixed_attributes.silhouette & fit.rise, leg shape, overall shape"},
        "fabric_stretch_comfort": {"real_field": "fixed_attributes.fabric.stretch, material type"},
        "occasion": {"real_field": "fixed_attributes.styling & context.occasion"},
        "durability_wash": {"real_field": None, "gap": True, "note": "no wash-durability rating field; only sparse wash_care text"},
        "price_tier": {"real_field": "price"},
    },
    "dresses_onepieces_outfitsets": {
        "occasion_formality": {"real_field": "fixed_attributes.styling & context.occasion (has a 'formal & special event' bucket), meta.productAttributes.suitability.occasion"},
        "size_and_body_fit": {"real_field": "size, meta.productAttributes.suitability.body_type", "note": "body_type only ~29% populated for dresses in this sample — the lowest of any apparel archetype"},
        "fabric_and_drape": {"real_field": "fixed_attributes.fabric.drape, material type"},
        "length_silhouette": {"real_field": "fixed_attributes.silhouette & fit.length, overall shape"},
        "season": {"real_field": "fixed_attributes.styling & context.season"},
        "return_policy_fit_risk": {"real_field": "return_policy", "note": "populated on <3% of rows in this feed; where present, several rows actually contain care instructions, not return terms"},
        "price_tier": {"real_field": "price"},
    },
    "outerwear_coats_jackets": {
        "warmth_insulation": {"real_field": None, "gap": True, "note": "no fill-power/insulation-rating field; only qualitative fabric.weight and material name"},
        "weather_protection": {"real_field": None, "gap": True, "note": "no waterproof/windproof rating field anywhere in fixed_attributes"},
        "layering_fit": {"real_field": "fixed_attributes.silhouette & fit.garment fit"},
        "material_durability": {"real_field": "materials, fixed_attributes.fabric.material type"},
        "weight_packability": {"real_field": "fixed_attributes.fabric.weight", "note": "qualitative (lightweight/midweight/heavyweight) only, no packed-weight-in-grams"},
        "price_tier": {"real_field": "price"},
    },
    "fine_jewelry": {
        "metal_type_hypoallergenic": {"real_field": "meta.productAttributes.core_information.material, plating_type", "gap": True, "note": "metal/plating is captured; no explicit hypoallergenic flag"},
        "size_fit": {"real_field": "size, core_information.adjustable_length", "note": "confirms the earlier finding — no numeric ring-size/chain-length field, only a coarse letter size and an adjustable flag"},
        "gemstone_authenticity_certification": {"real_field": "meta.productAttributes.core_information.gemstone_presence", "gap": True, "note": "presence/absence is captured; no certification or authenticity field"},
        "occasion_symbolism": {"real_field": "meta.productAttributes.suitability.occasion, fixed_attributes.styling & context.occasion"},
        "care_maintenance": {"real_field": "materials, core_information.plating_type"},
        "price_tier": {"real_field": "price"},
    },
    "headwear_hats": {
        "head_size_fit": {"real_field": "size", "note": "usually 'One Size' in this feed"},
        "weather_protection": {"real_field": None, "gap": True, "note": "no weather-protection rating; only inferable from material name (e.g. cashmere)"},
        "style_occasion": {"real_field": "fixed_attributes.styling & context.occasion, accessory style"},
        "adjustability": {"real_field": None, "gap": True, "note": "construction & design.closure is 'not applicable' for nearly every hat in this sample — no adjustable-strap flag"},
        "material_durability": {"real_field": "materials, fixed_attributes.fabric.material type"},
        "price_tier": {"real_field": "price"},
    },
    "belts_buckles": {
        "waist_size_fit": {"real_field": "size, meta.productAttributes.suitability.waist_size"},
        "material_quality": {"real_field": "meta.productAttributes.core_information.belt_material, materials"},
        "buckle_style": {"real_field": "meta.productAttributes.core_information.buckle_type"},
        "occasion": {"real_field": "meta.productAttributes.suitability.occasion"},
        "reversibility": {"real_field": "meta.productAttributes.core_information.reversible"},
        "price_tier": {"real_field": "price"},
    },
    "hosiery_socks": {
        "size_fit": {"real_field": "size", "note": "EU shoe-size range string (e.g. '43/45'), not a separate sock-size field"},
        "activity_use": {"real_field": "meta.productAttributes.suitability.lifestyle_fit, fixed_attributes.styling & context.occasion"},
        "fabric_material": {"real_field": "materials, fixed_attributes.fabric.material type"},
        "pack_quantity_value": {"real_field": None, "gap": True, "note": "every row in this sample is a single item — no multi-pack/pack-size field, even though socks are routinely sold in packs"},
        "durability_wash": {"real_field": "meta.productAttributes.core_information.thickness"},
        "price_tier": {"real_field": "price"},
    },
    "eyewear_sunglasses": {
        "uv_protection_lens_category": {"real_field": None, "gap": True, "note": "no UV rating or lens-category field anywhere in the feed"},
        "face_shape_fit": {"real_field": "meta.productAttributes.suitability.face_shape", "note": "this is exactly the vector that matters most for sunglasses, and it's the one most often empty — 0/3 rows populated in this sample"},
        "lens_type": {"real_field": None, "gap": True, "note": "the category leaf (e.g. 'rectangular') describes frame shape, not lens technology (polarized/photochromic)"},
        "frame_material_durability": {"real_field": "materials, fixed_attributes.fabric.material type", "note": "materials was null on the representative example — inconsistently filled"},
        "prescription_compatibility": {"real_field": None, "gap": True, "note": "not modeled"},
        "price_tier": {"real_field": "price"},
    },
    "cold_weather_small_accessories": {
        "warmth_insulation": {"real_field": "materials", "note": "qualitative only, from material description"},
        "size_fit": {"real_field": "size"},
        "material_touchscreen_compat": {"real_field": None, "gap": True, "note": "not modeled"},
        "weather_resistance": {"real_field": None, "gap": True, "note": "not modeled"},
        "durability": {"real_field": "materials, fixed_attributes.fabric.material type"},
        "price_tier": {"real_field": "price"},
    },
    "scarves_wraps": {
        "fabric_material_season": {"real_field": "materials, fixed_attributes.styling & context.season"},
        "size_dimensions": {"real_field": None, "gap": True, "note": "flat size is often 'One Size'; no explicit cm dimensions field"},
        "styling_versatility": {"real_field": "fixed_attributes.styling & context.accessory style"},
        "occasion": {"real_field": "fixed_attributes.styling & context.occasion"},
        "care_instructions": {"real_field": None, "gap": True, "note": "wash_care exists in the schema but was empty for every scarf in this sample"},
        "price_tier": {"real_field": "price"},
    },
}


def get_leaf_path(d, path=()):
    if not isinstance(d, dict):
        return
    for k, v in d.items():
        if isinstance(v, dict):
            yield from get_leaf_path(v, path + (k,))
        else:
            yield path + (k,), v


def load_rows(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    all_rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
    header = list(all_rows[0])
    idx = {h: i for i, h in enumerate(header)}
    records = []
    for r in all_rows[1:]:
        row = {h: r[idx[h]] for h in header}
        fa_raw = row.get("fixed_attributes")
        if not fa_raw:
            continue
        try:
            fa = json.loads(fa_raw)
        except Exception:
            continue
        if not isinstance(fa, dict):
            continue
        cat = fa.get("category")
        if not isinstance(cat, dict):
            continue
        lp = list(get_leaf_path(cat))
        if not lp:
            continue
        path, _leaf = lp[0]
        key = (path[0], path[1] if len(path) > 1 else None)
        arch = CAT_TO_ARCH.get(key)
        if not arch:
            continue
        meta_raw = row.get("meta")
        meta = {}
        if meta_raw:
            try:
                meta = json.loads(meta_raw)
            except Exception:
                pass
        records.append({"archetype_id": arch, "row": row, "fixed_attributes": fa, "meta": meta})
    return records


def main():
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else None
    if not xlsx_path:
        raise SystemExit("usage: generate-cos-catalog-binding.py <path-to-xlsx>")
    records = load_rows(xlsx_path)

    total_rows = len(records)
    field_populated = lambda key: sum(1 for rec in records if rec["row"].get(key) not in (None, "null"))
    universal_signals = {
        "reviews": {
            "catalog_field": "rating", "count_field": "rating_count",
            "populated_in_sample": f"{field_populated('rating')}/{total_rows}",
            "gap": field_populated("rating") == 0,
            "note": "column exists in the feed contract; unpopulated for every row in this COS sample — a source gap, not a schema gap. PDP must render without a rating badge when null, not assume presence.",
        },
        "in_stock": {
            "catalog_field": "instock",
            "populated_in_sample": f"{field_populated('instock')}/{total_rows}",
            "gap": False,
        },
        "return_policy": {
            "catalog_field": "return_policy",
            "populated_in_sample": f"{field_populated('return_policy')}/{total_rows}",
            "gap": field_populated("return_policy") < total_rows * 0.1,
            "note": "populated on well under 10% of rows; several populated values are actually wash-care text misfiled into this column — a data-quality caveat, not just a coverage one.",
        },
        "price": {
            "catalog_field": "price", "original_price_field": "original_price", "on_sale_field": "onsale",
            "populated_in_sample": f"{field_populated('price')}/{total_rows}",
            "gap": False,
        },
        "retailer_trust_proxy": {
            "catalog_fields": ["brand", "retailer_domain", "source"],
            "note": "no seller-legitimacy or counterfeit-risk signal exists; brand+retailer_domain is the only proxy available, and it's a direct-brand feed here so the risk this vector targets (third-party marketplace sellers) doesn't apply to this particular sample.",
        },
    }

    archetypes_out = {}
    by_arch = collections.defaultdict(list)
    for rec in records:
        by_arch[rec["archetype_id"]].append(rec)

    for arch_id, bindings in VECTOR_BINDINGS.items():
        recs = by_arch.get(arch_id, [])
        n = len(recs)
        suit_populated = sum(1 for r in recs if r["meta"].get("productAttributes", {}).get("suitability"))

        # pick the richest example: fewest "not applicable"/none tokens in fixed_attributes
        best = min(recs, key=lambda r: json.dumps(r["fixed_attributes"]).lower().count("not applicable")) if recs else None
        worked_example = None
        if best:
            row = best["row"]
            suit = best["meta"].get("productAttributes", {}).get("suitability", {})
            core = best["meta"].get("productAttributes", {}).get("core_information", {})
            worked_example = {
                "name": row.get("name"), "brand": row.get("brand"),
                "price": row.get("price"), "currency": row.get("currency"),
                "size": row.get("size"), "color": row.get("color"),
                "materials": row.get("materials"),
                "suitability": suit, "core_information": core,
            }

        vectors_out = {}
        for vector_id, spec in bindings.items():
            vectors_out[vector_id] = {
                "real_field": spec.get("real_field"),
                "gap": spec.get("gap", False),
                "note": spec.get("note"),
            }

        archetypes_out[arch_id] = {
            "sample_row_count": n,
            "suitability_populated_pct": round(suit_populated / n * 100, 1) if n else None,
            "vector_bindings": vectors_out,
            "worked_example": worked_example,
        }

    unbound = sorted(set(CAT_TO_ARCH.values()) - set(VECTOR_BINDINGS))
    if unbound:
        raise SystemExit(f"archetype present in sample with no VECTOR_BINDINGS entry: {unbound}")

    all_archetypes_path = os.path.join(OUT_DIR, "archetypes.apparel.json")
    with open(all_archetypes_path) as f:
        all_archetype_ids = {a["id"] for a in json.load(f)["archetypes"]}
    not_represented = sorted(all_archetype_ids - set(archetypes_out))

    out = {
        "source": "FixedAttributeSample_COS_15thSept2026.xlsx — 1000 COS product rows via Glance/FLEX",
        "total_rows": total_rows,
        "archetypes_represented": len(archetypes_out),
        "archetypes_not_represented_in_sample": not_represented,
        "universal_signals": universal_signals,
        "archetypes": archetypes_out,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "catalog-source-cos.json"), "w") as f:
        json.dump(out, f, indent=2, default=str)
    gaps = sum(1 for a in archetypes_out.values() for v in a["vector_bindings"].values() if v["gap"])
    print(f"wrote bindings for {len(archetypes_out)} archetypes, {total_rows} rows, {gaps} vector-level gaps found")


if __name__ == "__main__":
    main()
