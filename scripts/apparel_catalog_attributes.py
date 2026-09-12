"""
Runtime catalog-attribute layer for the Apparel & Accessories decision schema.

`archetypes.apparel.json` already has, per archetype, narrative decision
vectors (why a shopper cares, how a human would evaluate it). This module
adds the machine-usable half: for each decision vector, what a catalog item
needs to carry (attribute id, value type, required-ness), and how that
attribute gets matched against the user at PDP render time (which profile/
memory/context field it compares against, how the comparison works, and
what it renders as on the page).

Design: ATTRIBUTE_TYPES is a small registry (~16 entries) of reusable
attribute *shapes* — almost every decision vector across 30 archetypes is
one of a handful of recurring patterns (a size/fit lookup, a price-tier
filter, an occasion tag, a material spec, ...). VECTOR_OVERRIDES then maps
each (archetype_id, vector_id) to one of those types plus the small bit
that's genuinely specific to that vector (its enum values, its unit, which
exact profile field it reads). generate-apparel-decision-schema.py resolves
the two into a flat `catalog_attribute` object on each decision vector, so
the shipped archetypes.apparel.json is self-contained — a consumer doesn't
need this registry at read time, only at authoring/regeneration time.

A note on `personalization_source: "size_profile"`: several attributes
here need a per-user body/fit measurement (top size, shoe size, ring size,
wrist size, ...) that **does not exist yet** in this app's `UserMemory`
schema (today: household_size, dietary_prefs, budget_tier, brand_prefs).
It's flagged wherever used with `"proposed_memory_extension": true` rather
than silently assumed — implementing this schema for real means adding a
durable `size_profile` sub-object to `UserMemory` first (still governed by
the existing memory_write boundary: durable and cross-session, same as
today's fields, just not built yet).
"""

ATTRIBUTE_TYPES = {
    "size_enum": {
        "value_type": "enum",
        "required": True,
        "personalization_source": "size_profile",
        "match_type": "exact_equals",
        "pdp_surface": "fit_badge",
        "proposed_memory_extension": True,
    },
    "size_numeric": {
        "value_type": "number",
        "required": True,
        "personalization_source": "size_profile",
        "match_type": "range_overlap",
        "pdp_surface": "fit_badge",
        "proposed_memory_extension": True,
    },
    "fit_style_pref": {
        "value_type": "enum",
        "required": False,
        "personalization_source": "order_history",
        "match_type": "categorical_preference_score",
        "pdp_surface": "why_this_fits_chip",
    },
    "material_spec": {
        "value_type": "multi_enum",
        "required": True,
        "personalization_source": "display_only",
        "match_type": "not_applicable",
        "pdp_surface": "spec_row",
    },
    "occasion_tag": {
        "value_type": "multi_enum",
        "required": False,
        "personalization_source": "scenario_slot",
        "personalization_field": "setting",
        "match_type": "categorical_preference_score",
        "pdp_surface": "sort_boost",
    },
    "season_climate": {
        "value_type": "enum",
        "required": False,
        "personalization_source": "scenario_slot",
        "personalization_field": "setting",
        "match_type": "categorical_preference_score",
        "pdp_surface": "filter_facet",
    },
    "price_tier": {
        "value_type": "number",
        "unit": "currency",
        "required": True,
        "personalization_source": "user_memory",
        "personalization_field": "budget_tier",
        "match_type": "range_overlap",
        "pdp_surface": "sort_boost",
    },
    "durability_rating": {
        "value_type": "rating_1_5",
        "required": False,
        "personalization_source": "display_only",
        "match_type": "not_applicable",
        "pdp_surface": "spec_row",
    },
    "safety_flag": {
        "value_type": "multi_enum",
        "required": False,
        "personalization_source": "household_context",
        "personalization_field": "household_size",
        "match_type": "flag_if_missing",
        "pdp_surface": "warning_banner",
    },
    "capacity_dimension": {
        "value_type": "number",
        "required": False,
        "personalization_source": "display_only",
        "match_type": "not_applicable",
        "pdp_surface": "spec_row",
    },
    "policy_flag": {
        "value_type": "boolean",
        "required": True,
        "personalization_source": "display_only",
        "match_type": "not_applicable",
        "pdp_surface": "warning_banner",
    },
    "lead_time": {
        "value_type": "number",
        "unit": "days",
        "required": False,
        "personalization_source": "scenario_slot",
        "personalization_field": "duration",
        "match_type": "threshold_lte",
        "pdp_surface": "warning_banner",
    },
    "compliance_spec": {
        "value_type": "enum",
        "required": False,
        "personalization_source": "use_case_context",
        "personalization_field": "use_case_requirement",
        "match_type": "exact_equals",
        "pdp_surface": "filter_facet",
    },
    "pack_value": {
        "value_type": "number",
        "unit": "units_per_pack",
        "required": False,
        "personalization_source": "display_only",
        "match_type": "not_applicable",
        "pdp_surface": "comparison_column",
    },
    "color_match": {
        "value_type": "enum",
        "required": False,
        "personalization_source": "size_profile",
        "match_type": "exact_equals",
        "pdp_surface": "filter_facet",
        "proposed_memory_extension": True,
    },
}


def attr(type_id, **overrides):
    """A (attribute_type id, overrides) pair; resolved against ATTRIBUTE_TYPES at generation time."""
    return {"attribute_type": type_id, "overrides": overrides}


# (archetype_id, vector_id) -> attr(...). Every decision_vector in every
# archetype must have exactly one entry here; the generator raises if any
# are missing so this stays in sync with ARCHETYPES by construction.
VECTOR_ATTRIBUTES = {
    ("everyday_tops_adult", "size_fit"): attr("size_enum", catalog_field="size", allowed_values=["XS","S","M","L","XL","XXL"], profile_field="size_profile.tops"),
    ("everyday_tops_adult", "fit_style"): attr("fit_style_pref", catalog_field="fit", allowed_values=["slim","regular","relaxed","oversized"]),
    ("everyday_tops_adult", "fabric_and_care"): attr("material_spec", catalog_field="material"),
    ("everyday_tops_adult", "occasion"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["casual","work","loungewear","going_out"]),
    ("everyday_tops_adult", "season_weight"): attr("season_climate", catalog_field="fabric_weight", allowed_values=["lightweight","midweight","heavyweight"]),
    ("everyday_tops_adult", "price_tier"): attr("price_tier", catalog_field="price"),

    ("bottoms_pants_shorts_skirts_adult", "waist_inseam_fit"): attr("size_numeric", catalog_field="waist_in,inseam_in", unit="inches", profile_field="size_profile.bottoms"),
    ("bottoms_pants_shorts_skirts_adult", "rise_and_silhouette"): attr("fit_style_pref", catalog_field="rise,silhouette", allowed_values=["high_rise","mid_rise","low_rise"]),
    ("bottoms_pants_shorts_skirts_adult", "fabric_stretch_comfort"): attr("material_spec", catalog_field="material,elastane_pct"),
    ("bottoms_pants_shorts_skirts_adult", "occasion"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["work","weekend","going_out","athleisure"]),
    ("bottoms_pants_shorts_skirts_adult", "durability_wash"): attr("durability_rating", catalog_field="denier_or_weight"),
    ("bottoms_pants_shorts_skirts_adult", "price_tier"): attr("price_tier", catalog_field="price"),

    ("dresses_onepieces_outfitsets", "occasion_formality"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["everyday","work","cocktail","formal"]),
    ("dresses_onepieces_outfitsets", "size_and_body_fit"): attr("size_enum", catalog_field="size", allowed_values=["XS","S","M","L","XL","XXL"], profile_field="size_profile.dresses"),
    ("dresses_onepieces_outfitsets", "fabric_and_drape"): attr("material_spec", catalog_field="material"),
    ("dresses_onepieces_outfitsets", "length_silhouette"): attr("fit_style_pref", catalog_field="length,silhouette", allowed_values=["mini","midi","maxi"]),
    ("dresses_onepieces_outfitsets", "season"): attr("season_climate", catalog_field="season"),
    ("dresses_onepieces_outfitsets", "return_policy_fit_risk"): attr("policy_flag", catalog_field="return_window_days"),

    ("outerwear_coats_jackets", "warmth_insulation"): attr("capacity_dimension", catalog_field="fill_power_or_insulation_type", unit="fill_power"),
    ("outerwear_coats_jackets", "weather_protection"): attr("safety_flag", catalog_field="waterproof_rating_mm", personalization_field=None),
    ("outerwear_coats_jackets", "layering_fit"): attr("fit_style_pref", catalog_field="fit", allowed_values=["slim","regular","layer_friendly"]),
    ("outerwear_coats_jackets", "material_durability"): attr("durability_rating", catalog_field="shell_material"),
    ("outerwear_coats_jackets", "weight_packability"): attr("capacity_dimension", catalog_field="packed_weight_g", unit="grams"),
    ("outerwear_coats_jackets", "price_tier"): attr("price_tier", catalog_field="price"),

    ("activewear_performance", "sport_specific_fit"): attr("occasion_tag", catalog_field="activity_tags", allowed_values=["running","yoga","training","dance","boxing"]),
    ("activewear_performance", "moisture_wicking_fabric"): attr("material_spec", catalog_field="fabric_technology"),
    ("activewear_performance", "support_level"): attr("durability_rating", catalog_field="support_rating", allowed_values=["low","medium","high"]),
    ("activewear_performance", "breathability"): attr("material_spec", catalog_field="ventilation_features"),
    ("activewear_performance", "durability_wash_frequency"): attr("durability_rating", catalog_field="fabric_quality_tier"),
    ("activewear_performance", "price_tier"): attr("price_tier", catalog_field="price"),

    ("baby_childrens_clothing", "age_size_growth_room"): attr("size_enum", catalog_field="age_size", allowed_values=["0-3m","3-6m","6-12m","12-24m","2T-4T","5-6","7-8","9-10","11-12"], profile_field="size_profile.child_age_size"),
    ("baby_childrens_clothing", "safety_materials"): attr("safety_flag", catalog_field="safety_certifications"),
    ("baby_childrens_clothing", "durability_wash_frequency"): attr("durability_rating", catalog_field="fabric_quality_tier"),
    ("baby_childrens_clothing", "comfort_sensitive_skin"): attr("material_spec", catalog_field="skin_comfort_features"),
    ("baby_childrens_clothing", "occasion"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["everyday","play","special_occasion"]),
    ("baby_childrens_clothing", "price_tier"): attr("price_tier", catalog_field="price"),

    ("lingerie_intimates_shapewear", "sizing_band_cup_accuracy"): attr("size_enum", catalog_field="band_cup_size", profile_field="size_profile.bra_size"),
    ("lingerie_intimates_shapewear", "support_level"): attr("durability_rating", catalog_field="support_rating", allowed_values=["light","medium","firm"]),
    ("lingerie_intimates_shapewear", "fabric_comfort_breathability"): attr("material_spec", catalog_field="material"),
    ("lingerie_intimates_shapewear", "coverage_style"): attr("fit_style_pref", catalog_field="coverage_style"),
    ("lingerie_intimates_shapewear", "return_exchange_policy"): attr("policy_flag", catalog_field="final_sale_flag"),
    ("lingerie_intimates_shapewear", "price_tier"): attr("price_tier", catalog_field="price"),

    ("mens_undergarments", "size_fit_waist"): attr("size_enum", catalog_field="waist_size", allowed_values=["S","M","L","XL","XXL"], profile_field="size_profile.bottoms"),
    ("mens_undergarments", "support_style"): attr("fit_style_pref", catalog_field="style", allowed_values=["brief","boxer","boxer_brief","trunk","jockstrap"]),
    ("mens_undergarments", "fabric_breathability"): attr("material_spec", catalog_field="material"),
    ("mens_undergarments", "pack_quantity_value"): attr("pack_value", catalog_field="pack_size"),
    ("mens_undergarments", "durability_wash"): attr("durability_rating", catalog_field="fabric_quality_tier"),
    ("mens_undergarments", "price_tier"): attr("price_tier", catalog_field="price"),

    ("hosiery_socks", "size_fit"): attr("size_numeric", catalog_field="shoe_size_range", profile_field="size_profile.footwear"),
    ("hosiery_socks", "activity_use"): attr("occasion_tag", catalog_field="activity_tags", allowed_values=["athletic","dress","thermal","everyday"]),
    ("hosiery_socks", "fabric_material"): attr("material_spec", catalog_field="material"),
    ("hosiery_socks", "pack_quantity_value"): attr("pack_value", catalog_field="pack_size"),
    ("hosiery_socks", "durability_wash"): attr("durability_rating", catalog_field="fabric_quality_tier"),
    ("hosiery_socks", "price_tier"): attr("price_tier", catalog_field="price"),

    ("suits_formalwear", "size_fit_tailoring_needs"): attr("size_enum", catalog_field="size,cut", profile_field="size_profile.suits"),
    ("suits_formalwear", "fabric_quality"): attr("material_spec", catalog_field="fabric_composition,construction"),
    ("suits_formalwear", "occasion_dress_code"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["business","black_tie","wedding_guest"]),
    ("suits_formalwear", "color_style"): attr("color_match", catalog_field="color"),
    ("suits_formalwear", "alteration_availability"): attr("policy_flag", catalog_field="alteration_service_flag"),
    ("suits_formalwear", "price_tier"): attr("price_tier", catalog_field="price"),

    ("bridal_occasion_dresses", "size_fit_alteration_lead_time"): attr("lead_time", catalog_field="alteration_lead_time_days", personalization_field="event_date"),
    ("bridal_occasion_dresses", "fabric_and_silhouette"): attr("material_spec", catalog_field="material,silhouette"),
    ("bridal_occasion_dresses", "preservation_care"): attr("policy_flag", catalog_field="preservation_service_flag"),
    ("bridal_occasion_dresses", "timeline_to_event"): attr("lead_time", catalog_field="production_lead_time_days", personalization_field="event_date"),
    ("bridal_occasion_dresses", "budget_one_time_use"): attr("price_tier", catalog_field="price"),
    ("bridal_occasion_dresses", "retailer_return_policy"): attr("policy_flag", catalog_field="final_sale_flag"),

    ("uniforms_workwear", "compliance_dress_code"): attr("compliance_spec", catalog_field="style_code,color,insignia"),
    ("uniforms_workwear", "durability_industrial_wash"): attr("durability_rating", catalog_field="fabric_weight,wash_rating"),
    ("uniforms_workwear", "safety_features"): attr("safety_flag", catalog_field="safety_certifications"),
    ("uniforms_workwear", "size_fit"): attr("size_enum", catalog_field="size", profile_field="size_profile.uniform"),
    ("uniforms_workwear", "comfort_allday_wear"): attr("material_spec", catalog_field="fabric_composition"),
    ("uniforms_workwear", "price_tier"): attr("pack_value", catalog_field="price_per_unit,pack_size"),

    ("traditional_ceremonial_clothing", "regional_sizing_drape"): attr("size_enum", catalog_field="regional_size_convention", profile_field="size_profile.traditional_wear"),
    ("traditional_ceremonial_clothing", "fabric_authenticity_craftsmanship"): attr("material_spec", catalog_field="fabric_origin,craftsmanship_claims"),
    ("traditional_ceremonial_clothing", "occasion_significance"): attr("occasion_tag", catalog_field="occasion_tags"),
    ("traditional_ceremonial_clothing", "care_instructions"): attr("material_spec", catalog_field="care_label"),
    ("traditional_ceremonial_clothing", "customization_tailoring"): attr("lead_time", catalog_field="customization_lead_time_days", personalization_field="event_date"),
    ("traditional_ceremonial_clothing", "price_tier"): attr("price_tier", catalog_field="price"),

    ("sleepwear_loungewear", "fabric_comfort_breathability"): attr("material_spec", catalog_field="material"),
    ("sleepwear_loungewear", "size_fit"): attr("size_enum", catalog_field="size", allowed_values=["XS","S","M","L","XL","XXL"], profile_field="size_profile.sleepwear"),
    ("sleepwear_loungewear", "season_weight"): attr("season_climate", catalog_field="fabric_weight"),
    ("sleepwear_loungewear", "care_instructions"): attr("material_spec", catalog_field="care_label"),
    ("sleepwear_loungewear", "style_coverage"): attr("fit_style_pref", catalog_field="coverage_style"),
    ("sleepwear_loungewear", "price_tier"): attr("price_tier", catalog_field="price"),

    ("swimwear_adult", "size_fit"): attr("size_enum", catalog_field="size", profile_field="size_profile.swimwear"),
    ("swimwear_adult", "coverage_style"): attr("fit_style_pref", catalog_field="coverage_style"),
    ("swimwear_adult", "support_structure"): attr("durability_rating", catalog_field="support_features"),
    ("swimwear_adult", "fabric_durability"): attr("material_spec", catalog_field="fabric_technology"),
    ("swimwear_adult", "occasion"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["pool","beach","swim_sport"]),
    ("swimwear_adult", "price_tier"): attr("price_tier", catalog_field="price"),

    ("headwear_hats", "head_size_fit"): attr("size_numeric", catalog_field="head_circumference_cm", unit="cm", profile_field="size_profile.head"),
    ("headwear_hats", "weather_protection"): attr("season_climate", catalog_field="weather_protection_type"),
    ("headwear_hats", "style_occasion"): attr("occasion_tag", catalog_field="occasion_tags"),
    ("headwear_hats", "adjustability"): attr("fit_style_pref", catalog_field="adjustable_flag"),
    ("headwear_hats", "material_durability"): attr("material_spec", catalog_field="material"),
    ("headwear_hats", "price_tier"): attr("price_tier", catalog_field="price"),

    ("bags_wallets_cases", "size_capacity"): attr("capacity_dimension", catalog_field="dimensions_cm,capacity_l"),
    ("bags_wallets_cases", "material_durability"): attr("material_spec", catalog_field="material"),
    ("bags_wallets_cases", "organization_compartments"): attr("capacity_dimension", catalog_field="compartment_count"),
    ("bags_wallets_cases", "occasion_use_case"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["everyday","travel","formal","work"]),
    ("bags_wallets_cases", "style_color"): attr("color_match", catalog_field="color"),
    ("bags_wallets_cases", "price_tier"): attr("price_tier", catalog_field="price"),

    ("costumes_partywear", "size_fit_one_time_use"): attr("size_enum", catalog_field="size", allowed_values=["S","M","L","XL"], profile_field="size_profile.costume"),
    ("costumes_partywear", "occasion_theme_accuracy"): attr("occasion_tag", catalog_field="theme_tags"),
    ("costumes_partywear", "comfort_wearability_duration"): attr("material_spec", catalog_field="material"),
    ("costumes_partywear", "material_safety"): attr("safety_flag", catalog_field="flame_retardant_flag"),
    ("costumes_partywear", "accessory_completeness"): attr("capacity_dimension", catalog_field="included_accessories_count"),
    ("costumes_partywear", "price_tier"): attr("price_tier", catalog_field="price"),

    ("maternity_clothing", "stage_of_pregnancy_growth_room"): attr("size_enum", catalog_field="trimester_range", profile_field="size_profile.maternity_stage"),
    ("maternity_clothing", "belly_support_panel_type"): attr("fit_style_pref", catalog_field="panel_type", allowed_values=["full_panel","ruched","under_belly","side_panel"]),
    ("maternity_clothing", "nursing_accessibility"): attr("safety_flag", catalog_field="nursing_access_flag", personalization_field=None),
    ("maternity_clothing", "fabric_comfort_stretch"): attr("material_spec", catalog_field="material,elastane_pct"),
    ("maternity_clothing", "versatility_postpartum"): attr("durability_rating", catalog_field="postpartum_wearable_flag"),
    ("maternity_clothing", "price_tier"): attr("price_tier", catalog_field="price"),

    ("scarves_wraps", "fabric_material_season"): attr("season_climate", catalog_field="material"),
    ("scarves_wraps", "size_dimensions"): attr("capacity_dimension", catalog_field="dimensions_cm"),
    ("scarves_wraps", "styling_versatility"): attr("fit_style_pref", catalog_field="styling_tags"),
    ("scarves_wraps", "occasion"): attr("occasion_tag", catalog_field="occasion_tags"),
    ("scarves_wraps", "care_instructions"): attr("material_spec", catalog_field="care_label"),
    ("scarves_wraps", "price_tier"): attr("price_tier", catalog_field="price"),

    ("cold_weather_small_accessories", "warmth_insulation"): attr("material_spec", catalog_field="insulation_type"),
    ("cold_weather_small_accessories", "size_fit"): attr("size_enum", catalog_field="size", allowed_values=["S","M","L","XL"], profile_field="size_profile.accessories"),
    ("cold_weather_small_accessories", "material_touchscreen_compat"): attr("safety_flag", catalog_field="touchscreen_compatible_flag", personalization_field=None),
    ("cold_weather_small_accessories", "weather_resistance"): attr("season_climate", catalog_field="water_resistance_rating"),
    ("cold_weather_small_accessories", "durability"): attr("durability_rating", catalog_field="fabric_quality_tier"),
    ("cold_weather_small_accessories", "price_tier"): attr("price_tier", catalog_field="price"),

    ("belts_buckles", "waist_size_fit"): attr("size_numeric", catalog_field="length_range_in", unit="inches", profile_field="size_profile.bottoms"),
    ("belts_buckles", "material_quality"): attr("material_spec", catalog_field="material"),
    ("belts_buckles", "buckle_style"): attr("fit_style_pref", catalog_field="buckle_style"),
    ("belts_buckles", "occasion"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["casual","formal"]),
    ("belts_buckles", "reversibility"): attr("durability_rating", catalog_field="reversible_flag"),
    ("belts_buckles", "price_tier"): attr("price_tier", catalog_field="price"),

    ("watches_smartwatches", "case_size_wrist_fit"): attr("size_numeric", catalog_field="case_size_mm,band_length_range", unit="mm", profile_field="size_profile.wrist"),
    ("watches_smartwatches", "features_smart_vs_analog"): attr("occasion_tag", catalog_field="feature_set", allowed_values=["analog","smart_fitness","smart_full"]),
    ("watches_smartwatches", "battery_water_resistance"): attr("capacity_dimension", catalog_field="battery_life_hrs,water_resistance_m"),
    ("watches_smartwatches", "band_material_compatibility"): attr("material_spec", catalog_field="band_material,attachment_type"),
    ("watches_smartwatches", "style_occasion"): attr("occasion_tag", catalog_field="occasion_tags"),
    ("watches_smartwatches", "price_tier"): attr("price_tier", catalog_field="price"),

    ("neckwear_formalwear_accessories", "occasion_dress_code"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["business","black_tie","wedding"]),
    ("neckwear_formalwear_accessories", "color_pattern_coordination"): attr("color_match", catalog_field="color,pattern"),
    ("neckwear_formalwear_accessories", "material_silk_quality"): attr("material_spec", catalog_field="material"),
    ("neckwear_formalwear_accessories", "width_style_trend"): attr("fit_style_pref", catalog_field="width_style"),
    ("neckwear_formalwear_accessories", "care_instructions"): attr("material_spec", catalog_field="care_label"),
    ("neckwear_formalwear_accessories", "price_tier"): attr("price_tier", catalog_field="price"),

    ("hair_accessories", "hair_type_compatibility"): attr("occasion_tag", catalog_field="hair_type_tags", allowed_values=["fine","thick","curly","all"]),
    ("hair_accessories", "material_comfort"): attr("material_spec", catalog_field="material,grip_technology"),
    ("hair_accessories", "occasion_style"): attr("occasion_tag", catalog_field="occasion_tags"),
    ("hair_accessories", "durability"): attr("durability_rating", catalog_field="material_quality_tier"),
    ("hair_accessories", "color_match"): attr("color_match", catalog_field="color_code", profile_field="size_profile.hair_color"),
    ("hair_accessories", "price_tier"): attr("price_tier", catalog_field="price"),

    ("eyewear_sunglasses", "uv_protection_lens_category"): attr("safety_flag", catalog_field="uv_rating", personalization_field=None),
    ("eyewear_sunglasses", "face_shape_fit"): attr("fit_style_pref", catalog_field="frame_shape", profile_field="size_profile.face_shape"),
    ("eyewear_sunglasses", "lens_type"): attr("occasion_tag", catalog_field="lens_type_tags", allowed_values=["polarized","photochromic","mirrored","standard"]),
    ("eyewear_sunglasses", "frame_material_durability"): attr("material_spec", catalog_field="frame_material"),
    ("eyewear_sunglasses", "prescription_compatibility"): attr("safety_flag", catalog_field="rx_compatible_flag", personalization_field=None),
    ("eyewear_sunglasses", "price_tier"): attr("price_tier", catalog_field="price"),

    ("fine_jewelry", "metal_type_hypoallergenic"): attr("safety_flag", catalog_field="metal_type,hypoallergenic_flag"),
    ("fine_jewelry", "size_fit"): attr("size_numeric", catalog_field="ring_size,chain_length_in", profile_field="size_profile.jewelry"),
    ("fine_jewelry", "gemstone_authenticity_certification"): attr("policy_flag", catalog_field="certification_flag"),
    ("fine_jewelry", "occasion_symbolism"): attr("occasion_tag", catalog_field="occasion_tags", allowed_values=["gift","engagement","everyday"]),
    ("fine_jewelry", "care_maintenance"): attr("material_spec", catalog_field="plating_type,care_instructions"),
    ("fine_jewelry", "price_tier"): attr("price_tier", catalog_field="price"),

    ("footwear", "size_width_fit"): attr("size_numeric", catalog_field="shoe_size,width", profile_field="size_profile.footwear"),
    ("footwear", "activity_use_case"): attr("occasion_tag", catalog_field="activity_tags", allowed_values=["running","hiking","dress","casual","work"]),
    ("footwear", "material_breathability_weather"): attr("material_spec", catalog_field="upper_material"),
    ("footwear", "arch_support_comfort"): attr("durability_rating", catalog_field="insole_support_rating"),
    ("footwear", "durability_sole_quality"): attr("durability_rating", catalog_field="sole_material"),
    ("footwear", "growth_room"): attr("size_numeric", catalog_field="child_size_allowance", profile_field="size_profile.child_footwear"),
    ("footwear", "price_tier"): attr("price_tier", catalog_field="price"),

    ("shoe_care_accessories", "shoe_type_compatibility"): attr("compliance_spec", catalog_field="compatible_shoe_types"),
    ("shoe_care_accessories", "material_function"): attr("material_spec", catalog_field="material,function"),
    ("shoe_care_accessories", "size_fit"): attr("size_numeric", catalog_field="shoe_size_range", profile_field="size_profile.footwear"),
    ("shoe_care_accessories", "durability"): attr("durability_rating", catalog_field="material_quality_tier"),
    ("shoe_care_accessories", "price_tier"): attr("pack_value", catalog_field="price,pack_size"),

    ("general_clothing_accessories", "use_case_occasion"): attr("occasion_tag", catalog_field="occasion_tags"),
    ("general_clothing_accessories", "material_comfort_safety"): attr("material_spec", catalog_field="material"),
    ("general_clothing_accessories", "size_fit_adjustability"): attr("fit_style_pref", catalog_field="adjustable_flag"),
    ("general_clothing_accessories", "style_coordination"): attr("color_match", catalog_field="color"),
    ("general_clothing_accessories", "price_tier"): attr("price_tier", catalog_field="price"),
}
