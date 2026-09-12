"""
Generates the Apparel & Accessories product-decision schema:
  - docs/schemas/product-decision-schema/archetypes.apparel.json
  - docs/schemas/product-decision-schema/leaf-mapping.apparel.json

Input: the Google product taxonomy leaves under "Apparel & Accessories"
(the 403 deepest category nodes from the Category<>Count workbook, sheet 1).
This taxonomy is independent of this app's own use-case taxonomy in
category-taxonomy.json (events/travel/home/seasonal) — it exists to key
per-category product-decision vectors for the agentic product detail page,
not to classify use cases.

403 leaves is too many to hand-author a decision schema for one at a time,
so leaves are grouped into ~30 "archetypes" (clusters of leaves that share
the same real-world purchase decision) by matching each leaf's ancestor
path, and each archetype gets ONE hand-written set of decision vectors.
Re-run this file whenever the source leaf list changes; extend `classify()`
and `ARCHETYPES` together — every leaf must resolve to a known archetype id
(the script fails loudly if any leaf is unmatched).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
LEAVES_PATH = os.path.join(REPO_ROOT, "docs", "schemas", "product-decision-schema", "_apparel-leaves.json")
OUT_DIR = os.path.join(REPO_ROOT, "docs", "schemas", "product-decision-schema")


def classify(path):
    leaf = path[-1]

    if "Baby & Children's Clothing" in path:
        return "baby_childrens_clothing"
    if "Maternity Clothing" in path:
        return "maternity_clothing"
    if "Activewear" in path:
        return "activewear_performance"
    if leaf == "Hosiery" and "Lingerie" in path:
        return "hosiery_socks"
    if "Lingerie" in path:
        return "lingerie_intimates_shapewear"
    if "Men's Undergarments" in path:
        return "mens_undergarments"
    if "Socks" in path:
        return "hosiery_socks"
    if "Suits" in path:
        return "suits_formalwear"
    if "Wedding & Bridal Party Dresses" in path:
        return "bridal_occasion_dresses"
    if "Uniforms & Workwear" in path:
        return "uniforms_workwear"
    if "Traditional & Ceremonial Clothing" in path:
        return "traditional_ceremonial_clothing"
    if "Sleepwear & Loungewear" in path:
        return "sleepwear_loungewear"
    if "Swimwear" in path:
        return "swimwear_adult"
    if "Outerwear" in path:
        return "outerwear_coats_jackets"
    if "Clothing Tops" in path:
        return "everyday_tops_adult"
    if len(path) >= 2 and path[1] == "Clothing" and leaf in ("Dresses", "One-Pieces", "Outfit Sets"):
        return "dresses_onepieces_outfitsets"
    if "Pants" in path or "Shorts" in path:
        return "bottoms_pants_shorts_skirts_adult"
    if len(path) >= 2 and path[1] == "Clothing" and leaf in ("Skirts", "Skorts"):
        return "bottoms_pants_shorts_skirts_adult"
    if "Costumes & Accessories" in path:
        return "costumes_partywear"
    if "Handbags, Wallets & Cases" in path or "Handbag & Wallet Accessories" in path:
        return "bags_wallets_cases"
    if len(path) >= 2 and path[1] == "Jewelry":
        if leaf in ("Watches", "Smart Watches") or "Watch Accessories" in path:
            return "watches_smartwatches"
        return "fine_jewelry"
    if "Shoe Accessories" in path:
        return "shoe_care_accessories"
    if len(path) >= 2 and path[1] == "Shoes":
        return "footwear"
    if len(path) >= 2 and path[1] == "Clothing Accessories":
        if "Hats" in path or "Headwear" in path:
            return "headwear_hats"
        if "Hair Accessories" in path:
            return "hair_accessories"
        if leaf == "Sunglasses":
            return "eyewear_sunglasses"
        if leaf in ("Neckties", "Cufflinks", "Tie Clips", "Collar Stays", "Button Studs", "Suspenders"):
            return "neckwear_formalwear_accessories"
        if leaf in ("Scarves & Shawls", "Bandanas & Headties", "Sashes", "Handkerchiefs", "Leis"):
            return "scarves_wraps"
        if leaf in ("Gloves & Mittens", "Arm Warmers & Sleeves", "Leg Warmers", "Earmuffs",
                     "Hand Muffs", "Balaclavas", "Neck Gaiters", "Baby & Children's Gloves & Mittens"):
            return "cold_weather_small_accessories"
        if leaf in ("Belts", "Belt Buckles", "Baby & Children's Belts"):
            return "belts_buckles"
        return "general_clothing_accessories"
    return None


# id, label, covers, decision_vectors[{id,label,why_it_matters,how_to_evaluate,data_source}],
# personalization{durable_memory_inputs[], session_scenario_inputs[]}, best_way_to_buy
ARCHETYPES = {
"everyday_tops_adult": {
    "label": "Everyday tops",
    "covers": "Blouses, shirts, polos, sweaters, sweatshirts, hoodies, t-shirts, tank tops, tunics, cardigans, bodysuits, overshirts.",
    "decision_vectors": [
        {"id":"size_fit","label":"Size & fit","why_it_matters":"Tops are the single most-returned apparel type on true-to-size mismatches; brand sizing is not standardized.","how_to_evaluate":"Compare the retailer's size chart (chest/length) against the user's known measurements or past purchases.","data_source":"listing size chart, user profile, past order history"},
        {"id":"fit_style","label":"Fit style (slim / relaxed / oversized)","why_it_matters":"Same nominal size drapes very differently by cut, independent of body measurements.","how_to_evaluate":"Read the listing's fit description and photos; weight toward the user's stated style preference.","data_source":"listing copy, product photos, brand_prefs"},
        {"id":"fabric_and_care","label":"Fabric & care","why_it_matters":"Determines comfort, breathability, wrinkle behavior, and whether it survives frequent washing.","how_to_evaluate":"Extract fiber content and care label from the listing.","data_source":"listing specs"},
        {"id":"occasion","label":"Occasion","why_it_matters":"A work-appropriate blouse and a lounge tee solve different problems even in the same subcategory.","how_to_evaluate":"Match listing tags/description to the scenario's setting and stated purpose.","data_source":"scenario.setting, use-case description"},
        {"id":"season_weight","label":"Season & weight","why_it_matters":"Fabric weight determines whether the top is wearable for the season the scenario is set in.","how_to_evaluate":"Cross-check garment weight/material against the scenario's timing.","data_source":"listing specs, scenario slots"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Everyday basics have enormous price spread for near-identical function.","how_to_evaluate":"Filter/sort candidates to the user's budget_tier band.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting","time_of_day"]},
    "best_way_to_buy": "Favor retailers with free returns given how fit-dependent this category is."
},
"bottoms_pants_shorts_skirts_adult": {
    "label": "Pants, shorts & skirts",
    "covers": "Cargo pants, chinos, jeans, jeggings, joggers, leggings, trousers, and all adult shorts/skirts/skorts (excluding activewear, sleepwear, maternity and kids variants, which have their own archetypes).",
    "decision_vectors": [
        {"id":"waist_inseam_fit","label":"Waist & inseam fit","why_it_matters":"The two measurements that actually determine wearability, more reliable than a size label alone.","how_to_evaluate":"Match listed waist/inseam range to the user's known measurements or prior purchases.","data_source":"listing size chart, user profile"},
        {"id":"rise_and_silhouette","label":"Rise & silhouette","why_it_matters":"High/mid/low rise and slim/straight/wide leg change comfort and styling independent of size.","how_to_evaluate":"Read listing silhouette tags; weight by brand_prefs / past choices.","data_source":"listing specs, brand_prefs"},
        {"id":"fabric_stretch_comfort","label":"Fabric & stretch","why_it_matters":"Stretch percentage drives all-day comfort, especially for jeans and trousers.","how_to_evaluate":"Extract fiber content / elastane % from the listing.","data_source":"listing specs"},
        {"id":"occasion","label":"Occasion","why_it_matters":"Work trousers, weekend chinos, and going-out skirts aren't interchangeable.","how_to_evaluate":"Match to the scenario's setting/purpose.","data_source":"scenario.setting"},
        {"id":"durability_wash","label":"Durability & wash care","why_it_matters":"Bottoms see more wear-and-wash cycles than most apparel; matters more for daily-driver pieces.","how_to_evaluate":"Check fabric weight/denier and care instructions.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide spread between fast-fashion and durable-denim price points for the same garment type.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Favor retailers with a printed size chart and free returns — fit risk here is high."
},
"dresses_onepieces_outfitsets": {
    "label": "Dresses, one-pieces & outfit sets",
    "covers": "Dresses, one-pieces, and outfit sets (excluding bridal, maternity, kids and swim dresses, which have their own archetypes).",
    "decision_vectors": [
        {"id":"occasion_formality","label":"Occasion & formality","why_it_matters":"A cocktail dress, a sundress, and a wrap dress for the office solve unrelated problems.","how_to_evaluate":"Match listing occasion tags to the use case's event type.","data_source":"scenario/use-case description"},
        {"id":"size_and_body_fit","label":"Size & body fit","why_it_matters":"Dresses combine bust/waist/hip fit simultaneously, so mismatch risk compounds across three measurements.","how_to_evaluate":"Compare the listing's full size chart against the user's measurements.","data_source":"listing size chart, user profile"},
        {"id":"fabric_and_drape","label":"Fabric & drape","why_it_matters":"Drape determines how the silhouette actually looks on the body, which a flat product photo often misrepresents.","how_to_evaluate":"Read fabric composition and check for reviewer photos where available.","data_source":"listing specs, reviews"},
        {"id":"length_silhouette","label":"Length & silhouette","why_it_matters":"Mini/midi/maxi and A-line/bodycon/wrap are the main axes of personal style preference in this category.","how_to_evaluate":"Weight candidates by brand_prefs and past purchase pattern.","data_source":"brand_prefs, order history"},
        {"id":"season","label":"Season","why_it_matters":"Fabric weight and sleeve length need to match the scenario's timing.","how_to_evaluate":"Cross-check against scenario timing/setting.","data_source":"scenario slots"},
        {"id":"return_policy_fit_risk","label":"Return policy","why_it_matters":"Highest-return apparel category; a generous return window materially de-risks the purchase.","how_to_evaluate":"Surface the retailer's return window alongside the product.","data_source":"retailer policy (resolve_products)"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting","time_of_day"]},
    "best_way_to_buy": "Surface return window prominently; this is the highest fit-risk apparel category."
},
"outerwear_coats_jackets": {
    "label": "Outerwear, coats & jackets",
    "covers": "Coats & jackets (bomber, puffer, trench, parka, etc.), vests, motorcycle outerwear, rain suits/pants, snow pants & suits, chaps.",
    "decision_vectors": [
        {"id":"warmth_insulation","label":"Warmth / insulation rating","why_it_matters":"The primary functional spec — down fill weight or insulation type determines usable temperature range.","how_to_evaluate":"Extract fill power/insulation type from the listing and match to the scenario's climate.","data_source":"listing specs, scenario setting"},
        {"id":"weather_protection","label":"Weather protection","why_it_matters":"Waterproof/windproof rating matters far more here than in any other apparel archetype.","how_to_evaluate":"Check listed waterproof rating (e.g. mm hydrostatic head) if present.","data_source":"listing specs"},
        {"id":"layering_fit","label":"Layering fit","why_it_matters":"Outerwear needs to fit over whatever's worn underneath — sizing runs differently from a standalone top.","how_to_evaluate":"Recommend sizing up when the use case implies heavy layering (e.g. winter hiking).","data_source":"scenario slots, listing sizing notes"},
        {"id":"material_durability","label":"Material & durability","why_it_matters":"Outerwear is typically a multi-year purchase, so build quality matters more than in fast-turnover categories.","how_to_evaluate":"Check shell material and stitching/seam-sealing claims.","data_source":"listing specs"},
        {"id":"weight_packability","label":"Weight & packability","why_it_matters":"Relevant for travel or activity use cases where the jacket needs to pack down.","how_to_evaluate":"Check packed weight/volume if the use case involves travel.","data_source":"listing specs, use-case context"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Technical outerwear has a very wide price range tied directly to performance claims.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting","duration"]},
    "best_way_to_buy": "Weight heavily toward weather/warmth specs matching the scenario's actual climate, not just style."
},
"activewear_performance": {
    "label": "Activewear & performance wear",
    "covers": "Activewear pants/tops/sweatshirts/vests & jackets, sports bras, leotards & unitards, boxing shorts, dance costumes.",
    "decision_vectors": [
        {"id":"sport_specific_fit","label":"Sport-specific fit","why_it_matters":"Compression, freedom-of-movement, and chafe-prevention needs differ sharply by activity (running vs. yoga vs. lifting).","how_to_evaluate":"Match listing's stated activity use-case to the scenario.","data_source":"listing tags, use-case description"},
        {"id":"moisture_wicking_fabric","label":"Moisture-wicking fabric","why_it_matters":"Core functional differentiator versus ordinary loungewear at a similar silhouette.","how_to_evaluate":"Check fabric technology claims (e.g. polyester blends, brand-specific wicking tech).","data_source":"listing specs"},
        {"id":"support_level","label":"Support level","why_it_matters":"Especially for sports bras — under/over-supporting for the activity is a common complaint driving returns.","how_to_evaluate":"Match support rating (low/medium/high impact) to the stated activity.","data_source":"listing specs, use-case description"},
        {"id":"breathability","label":"Breathability","why_it_matters":"High-exertion use cases need airflow that casualwear fabrics don't provide.","how_to_evaluate":"Check for mesh panels / ventilation claims.","data_source":"listing specs"},
        {"id":"durability_wash_frequency","label":"Durability under frequent washing","why_it_matters":"Activewear is washed far more often than average apparel, accelerating fabric breakdown.","how_to_evaluate":"Check fabric quality tier and reviews for pilling/stretch-out complaints.","data_source":"listing specs, reviews"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Large premium for named performance-fabric technology over generic blends.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Prioritize matching the activity claim over general brand popularity."
},
"baby_childrens_clothing": {
    "label": "Baby & children's clothing",
    "covers": "All Baby & Children's Clothing leaves: tops, bottoms, dresses, one-pieces, outerwear, outfits, sleepwear, socks & tights, swimwear, underwear, diaper covers.",
    "decision_vectors": [
        {"id":"age_size_growth_room","label":"Age/size & growth room","why_it_matters":"Kids outgrow clothing in months; sizing by age band plus a growth allowance matters more than exact fit.","how_to_evaluate":"Match listing's age/size chart to the child's age or last known size, and bias toward slightly larger.","data_source":"listing size chart, user profile (household context)"},
        {"id":"safety_materials","label":"Safety & materials","why_it_matters":"Small parts, drawstrings, and harsh dyes are real safety/skin concerns unique to this archetype.","how_to_evaluate":"Check for safety certifications and non-toxic dye claims, especially for infants.","data_source":"listing specs"},
        {"id":"durability_wash_frequency","label":"Durability under frequent washing","why_it_matters":"Kids' clothing is washed and stressed (play, spills) far more than adult apparel of the same price.","how_to_evaluate":"Check fabric quality and reinforced-seam claims.","data_source":"listing specs, reviews"},
        {"id":"comfort_sensitive_skin","label":"Comfort for sensitive skin","why_it_matters":"Tagless labels, soft seams, and breathable fabric matter more for children, especially infants.","how_to_evaluate":"Check listing callouts (tagless, organic cotton, etc.).","data_source":"listing specs"},
        {"id":"occasion","label":"Occasion","why_it_matters":"Everyday play clothes and special-occasion outfits have very different durability-vs-style tradeoffs.","how_to_evaluate":"Match to the use case's stated purpose.","data_source":"scenario/use-case description"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Fast outgrow rate makes many households deliberately budget-conscious here regardless of general budget_tier.","how_to_evaluate":"Default toward value pricing unless the use case signals otherwise (e.g. a special occasion).","data_source":"user memory: budget_tier, household_size"}
    ],
    "personalization": {"durable_memory_inputs":["household_size","budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Default to value price points given the short usable lifespan, unless the use case is occasion-specific."
},
"lingerie_intimates_shapewear": {
    "label": "Lingerie, intimates & shapewear",
    "covers": "Bras, bodysuits, camisoles, hosiery, jock straps, petticoats, shapewear, women's underpants/undershirts/slips, bra & lingerie accessories.",
    "decision_vectors": [
        {"id":"sizing_band_cup_accuracy","label":"Sizing accuracy (band/cup or waist)","why_it_matters":"Brand-to-brand sizing is notoriously inconsistent in this category, more than almost any other apparel type.","how_to_evaluate":"Cross-reference the retailer's specific size chart rather than assuming standard sizing.","data_source":"listing size chart, user profile"},
        {"id":"support_level","label":"Support level","why_it_matters":"Functional requirement (everyday support vs. shapewear compression vs. minimal coverage) drives satisfaction more than style.","how_to_evaluate":"Match listing's support/compression rating to the stated need.","data_source":"listing specs, use-case description"},
        {"id":"fabric_comfort_breathability","label":"Fabric comfort & breathability","why_it_matters":"Worn against skin all day; irritation is the top complaint driver in reviews.","how_to_evaluate":"Check fiber content and review sentiment on comfort.","data_source":"listing specs, reviews"},
        {"id":"coverage_style","label":"Coverage & style","why_it_matters":"Highly personal preference axis independent of fit or function.","how_to_evaluate":"Weight by brand_prefs / past purchases.","data_source":"brand_prefs, order history"},
        {"id":"return_exchange_policy","label":"Return/exchange policy","why_it_matters":"Many retailers mark intimates as final-sale, which is decision-relevant given the high size-mismatch rate.","how_to_evaluate":"Surface the retailer's final-sale/exchange policy explicitly.","data_source":"retailer policy (resolve_products)"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide spread between basics multi-packs and premium fitted pieces.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":[]},
    "best_way_to_buy": "Flag final-sale/no-return policies clearly before purchase given high size-mismatch risk."
},
"mens_undergarments": {
    "label": "Men's undergarments",
    "covers": "Men's underwear (boxer briefs, boxers, briefs, trunks, jockstraps, etc.), undershirts, long johns.",
    "decision_vectors": [
        {"id":"size_fit_waist","label":"Size & waist fit","why_it_matters":"Comfort-critical, all-day-worn category where fit is the dominant satisfaction driver.","how_to_evaluate":"Match listing's waist-size chart to the user's known size.","data_source":"listing size chart, user profile"},
        {"id":"support_style","label":"Support style (brief / boxer / trunk / jockstrap)","why_it_matters":"Style preference here is strongly personal and usually consistent for a given user.","how_to_evaluate":"Weight heavily toward the user's past purchase pattern.","data_source":"order history, brand_prefs"},
        {"id":"fabric_breathability","label":"Fabric breathability","why_it_matters":"Cotton vs. moisture-wicking synthetic materially changes comfort and odor over a full day.","how_to_evaluate":"Check fiber content.","data_source":"listing specs"},
        {"id":"pack_quantity_value","label":"Pack quantity & value","why_it_matters":"Commonly bought in multi-packs; per-unit price and pack size matter as much as the individual item.","how_to_evaluate":"Compare per-unit price across pack sizes.","data_source":"listing pricing"},
        {"id":"durability_wash","label":"Durability under frequent washing","why_it_matters":"Highest wash-frequency apparel category; elastic waistband breakdown is the main failure mode.","how_to_evaluate":"Check reviews for waistband/elastic longevity complaints.","data_source":"reviews"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Large spread between basic multi-packs and premium performance fabrics.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":[]},
    "best_way_to_buy": "Default to the user's established support-style preference; treat as a repeat/replenishment purchase."
},
"hosiery_socks": {
    "label": "Socks & hosiery",
    "covers": "All Clothing > Socks leaves, Lingerie > Hosiery, and Baby & Children's Socks & Tights.",
    "decision_vectors": [
        {"id":"size_fit","label":"Size fit (shoe-size based)","why_it_matters":"Sized off shoe size rather than body measurement, and often the wrong axis if bought carelessly.","how_to_evaluate":"Match listing's shoe-size range to the user's known shoe size.","data_source":"listing size chart, user profile"},
        {"id":"activity_use","label":"Activity use (athletic / dress / thermal / everyday)","why_it_matters":"Cushioning, height (ankle/crew/knee), and material all follow from intended use.","how_to_evaluate":"Match to the use case's activity context.","data_source":"use-case description"},
        {"id":"fabric_material","label":"Fabric material","why_it_matters":"Cotton, wool, and compression/nylon blends serve different comfort and durability needs.","how_to_evaluate":"Check fiber content against the season/activity.","data_source":"listing specs"},
        {"id":"pack_quantity_value","label":"Pack quantity & value","why_it_matters":"Almost always bought in multi-packs; per-pair price is the meaningful comparison unit.","how_to_evaluate":"Normalize price per pair across pack sizes.","data_source":"listing pricing"},
        {"id":"durability_wash","label":"Durability under wash","why_it_matters":"Heel/toe wear-through is the dominant failure mode; matters for value comparison.","how_to_evaluate":"Check reviews for durability complaints.","data_source":"reviews"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide spread from basic multi-packs to technical/compression hosiery.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Compare on price-per-pair across pack sizes, not sticker price."
},
"suits_formalwear": {
    "label": "Suits",
    "covers": "Pant suits, skirt suits, tuxedos.",
    "decision_vectors": [
        {"id":"size_fit_tailoring_needs","label":"Size fit & tailoring needs","why_it_matters":"Off-the-rack fit is rarely perfect; whether alterations are realistic changes which product actually works.","how_to_evaluate":"Flag likely alteration needs based on size-chart deviation from the user's measurements.","data_source":"listing size chart, user profile"},
        {"id":"fabric_quality","label":"Fabric quality","why_it_matters":"Wool content and construction quality drive both appearance and how the piece holds up to repeat wear.","how_to_evaluate":"Check fabric composition and construction claims (e.g. half- vs. full-canvas).","data_source":"listing specs"},
        {"id":"occasion_dress_code","label":"Occasion & dress code","why_it_matters":"Business, black-tie, and wedding-guest dress codes call for genuinely different garments.","how_to_evaluate":"Match to the use case's stated dress code.","data_source":"use-case description"},
        {"id":"color_style","label":"Color & style","why_it_matters":"Versatility (navy/charcoal) vs. statement pieces is a real tradeoff for a wardrobe-planning purchase.","how_to_evaluate":"Weight by stated occasion frequency (one-off vs. recurring need).","data_source":"use-case description, brand_prefs"},
        {"id":"alteration_availability","label":"Alteration availability","why_it_matters":"Timeline-sensitive if there's an event date; not every retailer offers or partners for alterations.","how_to_evaluate":"Surface whether the retailer offers alteration services.","data_source":"retailer policy (resolve_products)"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Enormous price range from rental-grade to bespoke; budget_tier materially narrows the field.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting","duration"]},
    "best_way_to_buy": "Surface alteration lead time against the event date when the scenario has one."
},
"bridal_occasion_dresses": {
    "label": "Bridal & wedding-party dresses",
    "covers": "Wedding dresses, bridal party dresses.",
    "decision_vectors": [
        {"id":"size_fit_alteration_lead_time","label":"Size fit & alteration lead time","why_it_matters":"Near-universal need for alterations; lead time against the wedding date is often the binding constraint, more than price or style.","how_to_evaluate":"Compare estimated alteration turnaround to the time remaining before the event.","data_source":"retailer policy, use-case timeline"},
        {"id":"fabric_and_silhouette","label":"Fabric & silhouette","why_it_matters":"Season, venue formality, and body preference all drive this heavily-personal choice.","how_to_evaluate":"Match to stated venue/season and past style signals.","data_source":"use-case description, brand_prefs"},
        {"id":"preservation_care","label":"Preservation & care","why_it_matters":"Unlike ordinary apparel, buyers often plan for long-term preservation, not routine wear.","how_to_evaluate":"Surface fabric care needs and preservation service availability.","data_source":"listing specs, retailer policy"},
        {"id":"timeline_to_event","label":"Timeline to event","why_it_matters":"Drives urgency and whether custom/made-to-order options are even viable.","how_to_evaluate":"Compare production/shipping lead time to the event date.","data_source":"listing lead time, use-case timeline"},
        {"id":"budget_one_time_use","label":"Budget for one-time use","why_it_matters":"Spend-per-wear reasoning doesn't apply the way it does elsewhere in apparel; budget_tier needs to be read as a hard ceiling, not a preference.","how_to_evaluate":"Treat stated budget as a firm constraint rather than a soft signal.","data_source":"user memory: budget_tier"},
        {"id":"retailer_return_policy","label":"Return policy","why_it_matters":"Many bridal purchases are final-sale or custom, materially raising the stakes of getting size/style right upfront.","how_to_evaluate":"Surface the policy explicitly before purchase.","data_source":"retailer policy (resolve_products)"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["duration"]},
    "best_way_to_buy": "Lead with alteration/lead-time feasibility against the event date before style or price."
},
"uniforms_workwear": {
    "label": "Uniforms & workwear",
    "covers": "Contractor pants & coveralls, flight suits, food service uniforms, military/school/security/sports uniforms, scrubs, white coats.",
    "decision_vectors": [
        {"id":"compliance_dress_code","label":"Compliance with required spec","why_it_matters":"Often dictated by an employer, school, or regulation, not personal taste — the wrong color/style is simply non-compliant.","how_to_evaluate":"Match listing exactly against the stated required spec (color, insignia, style code) before any other vector.","data_source":"use-case description / institutional requirement"},
        {"id":"durability_industrial_wash","label":"Durability under industrial wash/wear","why_it_matters":"Worn daily and often industrially laundered; fabric breakdown is a real cost-of-ownership factor.","how_to_evaluate":"Check fabric weight and industrial-wash-safe claims.","data_source":"listing specs"},
        {"id":"safety_features","label":"Safety features","why_it_matters":"Flame-resistance, hi-vis, or antimicrobial properties are non-negotiable in some roles.","how_to_evaluate":"Check for relevant safety certifications tied to the occupation.","data_source":"listing specs, use-case context"},
        {"id":"size_fit","label":"Size fit","why_it_matters":"Worn for full shifts; poor fit has real comfort and safety consequences (e.g. loose fabric near equipment).","how_to_evaluate":"Match size chart to user profile.","data_source":"listing size chart, user profile"},
        {"id":"comfort_allday_wear","label":"All-day wear comfort","why_it_matters":"Breathability and stretch matter more here than in occasional-wear apparel.","how_to_evaluate":"Check fabric composition and reviews from same-occupation buyers where available.","data_source":"listing specs, reviews"},
        {"id":"price_tier","label":"Price tier & bulk value","why_it_matters":"Often bought in multiples; per-unit price at bulk quantities is the real comparison.","how_to_evaluate":"Compare per-unit price across pack sizes.","data_source":"listing pricing"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["duration"]},
    "best_way_to_buy": "Treat required spec/compliance as a hard filter applied before any preference-based ranking."
},
"traditional_ceremonial_clothing": {
    "label": "Traditional & ceremonial clothing",
    "covers": "Kimonos, saris & lehengas.",
    "decision_vectors": [
        {"id":"regional_sizing_drape","label":"Regional sizing & drape","why_it_matters":"Sizing conventions and draping style are region/culture-specific and don't map to Western size charts.","how_to_evaluate":"Match against the garment's own regional sizing convention, not a generic chart.","data_source":"listing specs specific to the garment tradition"},
        {"id":"fabric_authenticity_craftsmanship","label":"Fabric authenticity & craftsmanship","why_it_matters":"Buyers in this category often specifically value handwoven/traditional-technique fabric over mass production.","how_to_evaluate":"Surface fabric origin and craftsmanship claims explicitly.","data_source":"listing specs"},
        {"id":"occasion_significance","label":"Occasion significance","why_it_matters":"Frequently tied to a specific cultural or religious event where the wrong formality reads as a real mistake.","how_to_evaluate":"Match to the stated occasion.","data_source":"use-case description"},
        {"id":"care_instructions","label":"Care instructions","why_it_matters":"Often dry-clean-only or hand-wash-only, unlike most everyday apparel.","how_to_evaluate":"Surface care requirements prominently.","data_source":"listing specs"},
        {"id":"customization_tailoring","label":"Customization / tailoring availability","why_it_matters":"Many pieces are made-to-measure or need draping assistance; lead time is a real constraint.","how_to_evaluate":"Check whether the retailer offers customization and its lead time.","data_source":"retailer policy (resolve_products)"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range from ready-to-wear to heavily embellished custom pieces.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["duration"]},
    "best_way_to_buy": "Confirm customization lead time against the event date before finalizing style."
},
"sleepwear_loungewear": {
    "label": "Sleepwear & loungewear",
    "covers": "Pajamas, nightgowns, robes, onesies, long johns, loungewear tops/bottoms.",
    "decision_vectors": [
        {"id":"fabric_comfort_breathability","label":"Fabric comfort & breathability","why_it_matters":"Worn for extended low-activity periods; softness and temperature regulation dominate satisfaction.","how_to_evaluate":"Check fiber content (cotton/modal/flannel) against season.","data_source":"listing specs"},
        {"id":"size_fit","label":"Size fit (relaxed vs. snug)","why_it_matters":"Preference for loose vs. fitted sleepwear is strongly personal and fairly stable per user.","how_to_evaluate":"Weight by past purchase pattern.","data_source":"order history, brand_prefs"},
        {"id":"season_weight","label":"Season & weight","why_it_matters":"Flannel vs. lightweight cotton needs to match climate/season.","how_to_evaluate":"Cross-check fabric weight against scenario timing.","data_source":"listing specs, scenario slots"},
        {"id":"care_instructions","label":"Care instructions","why_it_matters":"Frequency of wash is high; easy-care fabric matters for everyday use.","how_to_evaluate":"Check care label.","data_source":"listing specs"},
        {"id":"style_coverage","label":"Style & coverage","why_it_matters":"Personal comfort/modesty preference independent of fit or fabric.","how_to_evaluate":"Weight by brand_prefs.","data_source":"brand_prefs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range between basic sets and premium sleepwear brands.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Weight comfort/fabric specs over styling — this is a comfort-first category."
},
"swimwear_adult": {
    "label": "Swimwear",
    "covers": "Adult swimwear: boardshorts, bikinis, one-piece swimsuits, cover-ups, rash guards, swim briefs/boxers, swimwear tops, surf tops.",
    "decision_vectors": [
        {"id":"size_fit","label":"Size fit (bust/waist/hip)","why_it_matters":"Combines multiple body measurements at once; one of the highest-anxiety apparel purchases.","how_to_evaluate":"Match the listing's full size chart to the user's measurements.","data_source":"listing size chart, user profile"},
        {"id":"coverage_style","label":"Coverage & style","why_it_matters":"Highly personal comfort preference, independent of size or activity.","how_to_evaluate":"Weight by brand_prefs / past purchases.","data_source":"brand_prefs, order history"},
        {"id":"support_structure","label":"Support structure","why_it_matters":"Underwire/padding/adjustable straps materially affect comfort and suitability for swimming vs. lounging.","how_to_evaluate":"Match to the stated activity (active swim vs. beach lounging).","data_source":"use-case description"},
        {"id":"fabric_durability","label":"Fabric chlorine/UV resistance","why_it_matters":"Pool chlorine and sun exposure degrade cheap fabric quickly; matters more for frequent swimmers.","how_to_evaluate":"Check fabric composition (chlorine-resistant blends) against frequency of use.","data_source":"listing specs, use-case context"},
        {"id":"occasion","label":"Occasion (pool / beach / swim-sport)","why_it_matters":"A competitive swim suit and a beach vacation suit are different products entirely.","how_to_evaluate":"Match to the use case's setting.","data_source":"scenario.setting"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide spread between fast-fashion and technical swimwear.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting","duration"]},
    "best_way_to_buy": "Favor retailers with a detailed size chart and lenient returns given the fit-anxiety in this category."
},
"headwear_hats": {
    "label": "Headwear & hats",
    "covers": "All Hats leaves (baseball caps, beanies, fedoras, etc.), Headwear (fascinators, headdresses, turbans), Baby & Children's Hats.",
    "decision_vectors": [
        {"id":"head_size_fit","label":"Head size & fit","why_it_matters":"Ill-fitting hats are uncomfortable and visibly wrong in a way clothing size mismatches often aren't.","how_to_evaluate":"Match listing's head-circumference sizing/adjustability to the user.","data_source":"listing size chart, user profile"},
        {"id":"weather_protection","label":"Weather protection (sun/rain/cold)","why_it_matters":"Functional purpose varies hugely across this archetype — a sun hat and a winter beanie solve opposite problems.","how_to_evaluate":"Match to the scenario's setting/season.","data_source":"scenario.setting"},
        {"id":"style_occasion","label":"Style & occasion","why_it_matters":"Ranges from purely functional to a strong personal-style statement (fascinators, fedoras).","how_to_evaluate":"Weight by use-case occasion and brand_prefs.","data_source":"use-case description, brand_prefs"},
        {"id":"adjustability","label":"Adjustability","why_it_matters":"Adjustable straps/bands reduce fit risk significantly versus a single fixed size.","how_to_evaluate":"Prefer adjustable options when the user's head size is unknown.","data_source":"listing specs"},
        {"id":"material_durability","label":"Material & durability","why_it_matters":"Straw, wool, and technical fabrics have very different lifespans and care needs.","how_to_evaluate":"Check material against intended frequency of use.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Range from inexpensive basics to designer/formal headwear.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Prefer adjustable sizing to de-risk fit unless the user's exact size is already known."
},
"bags_wallets_cases": {
    "label": "Bags, wallets & cases",
    "covers": "Handbags (all styles), wallets & money clips, badge/business-card/checkbook holders, keychains, lanyards, wallet chains.",
    "decision_vectors": [
        {"id":"size_capacity","label":"Size & capacity","why_it_matters":"Whether it actually fits what the user needs to carry (laptop, daily essentials, event-specific items) is the primary functional question.","how_to_evaluate":"Match listing dimensions/capacity claims to the use case's carrying needs.","data_source":"listing specs, use-case description"},
        {"id":"material_durability","label":"Material & durability","why_it_matters":"Leather vs. synthetic vs. canvas trades off cost, longevity, and maintenance very differently.","how_to_evaluate":"Check material composition and construction claims.","data_source":"listing specs"},
        {"id":"organization_compartments","label":"Organization & compartments","why_it_matters":"Practical daily usability often matters more than style once size/material are settled.","how_to_evaluate":"Check listed compartment/pocket layout against stated needs (cards, phone, keys, etc.).","data_source":"listing specs"},
        {"id":"occasion_use_case","label":"Occasion / use case","why_it_matters":"Everyday, travel, and formal-event bags have essentially disjoint requirements.","how_to_evaluate":"Match to the use case's setting/purpose.","data_source":"use-case description"},
        {"id":"style_color","label":"Style & color","why_it_matters":"Strong personal-style axis, especially for handbags.","how_to_evaluate":"Weight by brand_prefs / past purchases.","data_source":"brand_prefs, order history"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Enormous spread from basic to luxury/designer within the same functional category.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting","duration"]},
    "best_way_to_buy": "Anchor first on capacity/use case fit, then filter style and price within that."
},
"costumes_partywear": {
    "label": "Costumes & costume accessories",
    "covers": "Costume sets & dresses, costume shoes, costume accessories, masks.",
    "decision_vectors": [
        {"id":"size_fit_one_time_use","label":"Size fit for one-time use","why_it_matters":"Buyers typically accept looser sizing tolerance than for everyday apparel since wear is brief.","how_to_evaluate":"Use a wider acceptable size-match tolerance than other apparel archetypes.","data_source":"listing size chart"},
        {"id":"occasion_theme_accuracy","label":"Occasion / theme accuracy","why_it_matters":"The entire point of the purchase is matching a specific character or theme correctly.","how_to_evaluate":"Match listing description tightly against the stated theme/character.","data_source":"use-case description"},
        {"id":"comfort_wearability_duration","label":"Comfort for the wear duration","why_it_matters":"A costume worn for a few hours has different comfort tolerance than one worn all evening (e.g. a party vs. a long parade).","how_to_evaluate":"Match to the scenario's duration.","data_source":"scenario.duration"},
        {"id":"material_safety","label":"Material safety (esp. children's costumes)","why_it_matters":"Flame-retardant treatment and non-toxic materials matter more for kids' costumes specifically.","how_to_evaluate":"Check safety certifications when the use case involves a child.","data_source":"listing specs, household_size"},
        {"id":"accessory_completeness","label":"Accessory completeness","why_it_matters":"Costumes often need matching accessories (mask, props) to read as complete.","how_to_evaluate":"Surface commonly-paired accessories from the same listing/brand.","data_source":"listing cross-sell data"},
        {"id":"price_tier","label":"Price tier (one-time-use budget)","why_it_matters":"Buyers are typically less willing to pay premium prices for single-use items.","how_to_evaluate":"Default toward value pricing unless the use case signals a recurring need (e.g. professional performer).","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["household_size","budget_tier"], "session_scenario_inputs":["duration","setting"]},
    "best_way_to_buy": "Default to value pricing; this is a single-use purchase for most buyers."
},
"maternity_clothing": {
    "label": "Maternity clothing",
    "covers": "All Maternity Clothing leaves: dresses, one-pieces, pants, skirts, sleepwear, swimwear, tops, nursing bras.",
    "decision_vectors": [
        {"id":"stage_of_pregnancy_growth_room","label":"Stage of pregnancy & growth room","why_it_matters":"Fit needs change dramatically over ~9 months; the same size won't work through the whole pregnancy.","how_to_evaluate":"Match listing's stated trimester range/stretch capacity to the current or expected stage.","data_source":"listing specs, user-provided stage"},
        {"id":"belly_support_panel_type","label":"Belly support / panel type","why_it_matters":"Full-panel, ruched, or under-belly styles serve different comfort needs and garment types.","how_to_evaluate":"Match panel type to garment type and personal comfort preference.","data_source":"listing specs"},
        {"id":"nursing_accessibility","label":"Nursing accessibility","why_it_matters":"Relevant specifically for tops and nursing bras — clip-down or wrap access is a hard functional requirement, not a preference.","how_to_evaluate":"Filter to nursing-accessible designs when the item is a top or bra.","data_source":"listing specs"},
        {"id":"fabric_comfort_stretch","label":"Fabric comfort & stretch","why_it_matters":"Skin sensitivity and comfort needs are often heightened during pregnancy.","how_to_evaluate":"Check fiber content and stretch percentage.","data_source":"listing specs"},
        {"id":"versatility_postpartum","label":"Versatility into postpartum","why_it_matters":"Some buyers specifically value pieces that transition to postpartum/nursing use to reduce total spend.","how_to_evaluate":"Surface postpartum-wearability claims when present.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"A temporary-use wardrobe; many buyers are deliberately budget-conscious here.","how_to_evaluate":"Filter to budget_tier, defaulting conservative.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["duration"]},
    "best_way_to_buy": "Favor pieces with stated stretch/stage range and postpartum versatility to reduce total spend over the pregnancy."
},
"scarves_wraps": {
    "label": "Scarves, wraps & head coverings",
    "covers": "Scarves & shawls, bandanas & headties, sashes, handkerchiefs, leis.",
    "decision_vectors": [
        {"id":"fabric_material_season","label":"Fabric & season","why_it_matters":"Wool vs. silk vs. cotton determines whether it's a warmth accessory or a pure style piece.","how_to_evaluate":"Match fiber content to the scenario's season/setting.","data_source":"listing specs, scenario slots"},
        {"id":"size_dimensions","label":"Size & dimensions","why_it_matters":"Determines styling versatility (how it can be worn/tied) and whether it functions for its intended use (e.g. warmth vs. decoration).","how_to_evaluate":"Check listed dimensions against intended use.","data_source":"listing specs"},
        {"id":"styling_versatility","label":"Styling versatility","why_it_matters":"Many buyers value multi-way styling (neck, hair, bag) as a value driver.","how_to_evaluate":"Surface styling-versatility claims where present.","data_source":"listing description"},
        {"id":"occasion","label":"Occasion","why_it_matters":"Ranges from purely functional (cold-weather scarf) to occasion/cultural (leis, ceremonial sashes).","how_to_evaluate":"Match to the use case's stated purpose.","data_source":"use-case description"},
        {"id":"care_instructions","label":"Care instructions","why_it_matters":"Silk and delicate fabrics often require special care unlike everyday accessories.","how_to_evaluate":"Surface care requirements.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range from basic to luxury (e.g. silk designer scarves).","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Match fabric to season/purpose first; this category splits sharply between function and pure style."
},
"cold_weather_small_accessories": {
    "label": "Cold-weather & protective small accessories",
    "covers": "Gloves & mittens, arm warmers & sleeves, leg warmers, earmuffs, hand muffs, balaclavas, neck gaiters, baby & children's gloves & mittens.",
    "decision_vectors": [
        {"id":"warmth_insulation","label":"Warmth / insulation","why_it_matters":"Primary functional purpose; needs to match the scenario's actual temperature range.","how_to_evaluate":"Match insulation claims to scenario climate.","data_source":"listing specs, scenario setting"},
        {"id":"size_fit","label":"Size fit","why_it_matters":"Poor fit defeats the functional purpose (cold gaps) more than it does for outer garments.","how_to_evaluate":"Match sizing to user profile/age.","data_source":"listing size chart, user profile"},
        {"id":"material_touchscreen_compat","label":"Material & touchscreen compatibility","why_it_matters":"For gloves specifically, touchscreen compatibility is a common modern requirement.","how_to_evaluate":"Check for touchscreen-compatible fingertip claims when relevant.","data_source":"listing specs"},
        {"id":"weather_resistance","label":"Weather resistance","why_it_matters":"Water-resistance matters for outdoor/snow use cases specifically.","how_to_evaluate":"Match to scenario setting (outdoor/snow vs. indoor cold).","data_source":"scenario.setting"},
        {"id":"durability","label":"Durability","why_it_matters":"Small accessories are easily lost/worn out; buyers often value multi-packs or replaceable low-cost items.","how_to_evaluate":"Consider surfacing multi-pack options.","data_source":"listing options"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range from basic to technical cold-weather gear.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","household_size"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Match insulation/weather-resistance to the scenario's actual conditions, not general style."
},
"belts_buckles": {
    "label": "Belts & buckles",
    "covers": "Belts, belt buckles, baby & children's belts.",
    "decision_vectors": [
        {"id":"waist_size_fit","label":"Waist size fit","why_it_matters":"Straightforward but essential — the wrong length range makes the item unusable regardless of style.","how_to_evaluate":"Match listing's length range to the user's waist size.","data_source":"listing size chart, user profile"},
        {"id":"material_quality","label":"Material quality (leather vs. synthetic)","why_it_matters":"Drives both longevity and formality level.","how_to_evaluate":"Check material composition.","data_source":"listing specs"},
        {"id":"buckle_style","label":"Buckle style","why_it_matters":"Primary style-differentiation axis in this category.","how_to_evaluate":"Weight by brand_prefs.","data_source":"brand_prefs"},
        {"id":"occasion","label":"Occasion (casual / formal)","why_it_matters":"Casual and formal belts are rarely interchangeable in styling.","how_to_evaluate":"Match to use-case occasion.","data_source":"use-case description"},
        {"id":"reversibility","label":"Reversibility","why_it_matters":"Reversible belts offer two looks per purchase, a real value consideration.","how_to_evaluate":"Surface reversible options when budget-conscious.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range from basic to premium leather goods.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":[]},
    "best_way_to_buy": "Confirm exact waist-size range before style — this is the most common return reason."
},
"watches_smartwatches": {
    "label": "Watches & smartwatches",
    "covers": "Watches, smart watches, watch accessories (bands, winders, stickers).",
    "decision_vectors": [
        {"id":"case_size_wrist_fit","label":"Case size & wrist fit","why_it_matters":"Case diameter and band length/adjustability determine whether it's comfortable and proportionate to the wearer.","how_to_evaluate":"Match case size and band range to the user's known wrist size or past watches.","data_source":"listing specs, user profile"},
        {"id":"features_smart_vs_analog","label":"Features (smart vs. analog)","why_it_matters":"Fundamentally different purchase decisions — health tracking and notifications vs. pure timepiece/style.","how_to_evaluate":"Match to the use case's stated need (fitness tracking vs. everyday style vs. gift).","data_source":"use-case description"},
        {"id":"battery_water_resistance","label":"Battery life & water resistance","why_it_matters":"For smartwatches, battery life is a top satisfaction driver; water resistance matters for both types if used during activity.","how_to_evaluate":"Check specs against the use case's activity context.","data_source":"listing specs"},
        {"id":"band_material_compatibility","label":"Band material & compatibility","why_it_matters":"Interchangeable-band ecosystems add long-term value; band material affects daily comfort.","how_to_evaluate":"Check band material and standard/proprietary attachment.","data_source":"listing specs"},
        {"id":"style_occasion","label":"Style & occasion","why_it_matters":"Ranges from purely functional fitness tool to a status/style accessory.","how_to_evaluate":"Weight by brand_prefs and use-case occasion.","data_source":"brand_prefs, use-case description"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Enormous range from basic quartz to luxury/premium smartwatches.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":[]},
    "best_way_to_buy": "Clarify smart vs. analog intent first — it's a bigger fork than any style preference."
},
"neckwear_formalwear_accessories": {
    "label": "Neckwear & formalwear accessories",
    "covers": "Neckties, cufflinks, tie clips, collar stays, button studs, suspenders.",
    "decision_vectors": [
        {"id":"occasion_dress_code","label":"Occasion & dress code","why_it_matters":"Business, black-tie, and wedding dress codes call for genuinely different formality levels of these accessories.","how_to_evaluate":"Match to the stated dress code.","data_source":"use-case description"},
        {"id":"color_pattern_coordination","label":"Color & pattern coordination","why_it_matters":"Almost always bought to coordinate with a specific existing outfit, not standalone.","how_to_evaluate":"Match to any stated outfit/color context.","data_source":"use-case description"},
        {"id":"material_silk_quality","label":"Material / silk quality","why_it_matters":"Drives both appearance (sheen, drape) and price tier for neckties specifically.","how_to_evaluate":"Check fabric composition.","data_source":"listing specs"},
        {"id":"width_style_trend","label":"Width & style trend","why_it_matters":"Tie width and lapel-era styling go in and out of fashion; matters for a cohesive look.","how_to_evaluate":"Weight by brand_prefs and recent style signals.","data_source":"brand_prefs"},
        {"id":"care_instructions","label":"Care instructions","why_it_matters":"Silk ties typically require dry cleaning, unlike most accessories.","how_to_evaluate":"Surface care requirements.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Range from basic to designer silk pieces.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Anchor to the dress code and any existing outfit color before browsing style."
},
"hair_accessories": {
    "label": "Hair accessories",
    "covers": "Hair bands, combs, extensions, forks & sticks, nets, pins/claws/clips, wreaths, headbands, ponytail holders, tiaras, wigs & wig accessories.",
    "decision_vectors": [
        {"id":"hair_type_compatibility","label":"Hair type compatibility","why_it_matters":"Grip/hold performance varies significantly by hair thickness and texture (fine, thick, curly).","how_to_evaluate":"Match product claims (e.g. 'for thick hair') to the user's stated or known hair type.","data_source":"listing specs, user profile"},
        {"id":"material_comfort","label":"Material & comfort (grip, no-slip)","why_it_matters":"Comfort over hours of wear and reliable hold are the top satisfaction drivers.","how_to_evaluate":"Check material and grip-technology claims.","data_source":"listing specs"},
        {"id":"occasion_style","label":"Occasion & style","why_it_matters":"Ranges from purely functional (everyday hold) to decorative/formal (tiaras, wreaths).","how_to_evaluate":"Match to the use case's occasion.","data_source":"use-case description"},
        {"id":"durability","label":"Durability","why_it_matters":"Small accessories are prone to breaking; matters for value comparison, especially multi-packs.","how_to_evaluate":"Check reviews for durability complaints.","data_source":"reviews"},
        {"id":"color_match","label":"Color match","why_it_matters":"For wigs and extensions specifically, color match to natural hair is the dominant satisfaction driver.","how_to_evaluate":"Match listing color code to the user's stated hair color.","data_source":"listing specs, user profile"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range from basic multi-packs to premium wigs/extensions.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "For wigs/extensions, treat color match as a hard filter before any other vector."
},
"eyewear_sunglasses": {
    "label": "Sunglasses",
    "covers": "Sunglasses.",
    "decision_vectors": [
        {"id":"uv_protection_lens_category","label":"UV protection / lens category","why_it_matters":"The core functional/safety spec — not all cheap sunglasses provide adequate UV protection despite looking similar.","how_to_evaluate":"Verify listed UV protection rating (e.g. UV400) explicitly.","data_source":"listing specs"},
        {"id":"face_shape_fit","label":"Face shape fit","why_it_matters":"Frame shape flattering a given face shape is the dominant style-satisfaction driver.","how_to_evaluate":"Match frame shape recommendations to the user's stated/known face shape if available.","data_source":"listing specs, user profile"},
        {"id":"lens_type","label":"Lens type (polarized / photochromic / mirrored)","why_it_matters":"Functional differentiator for driving, water sports, or general glare reduction.","how_to_evaluate":"Match to the use case's activity context.","data_source":"use-case description"},
        {"id":"frame_material_durability","label":"Frame material & durability","why_it_matters":"Acetate, metal, and TR-90 plastic trade off weight, flexibility, and price.","how_to_evaluate":"Check frame material against intended use (e.g. sport vs. everyday).","data_source":"listing specs"},
        {"id":"prescription_compatibility","label":"Prescription compatibility","why_it_matters":"Relevant subset of buyers need prescription lens insert compatibility.","how_to_evaluate":"Surface prescription-ready options when relevant.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Enormous range from basic to designer/luxury frames.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Never compromise the UV-protection check regardless of style or price preference."
},
"fine_jewelry": {
    "label": "Fine & fashion jewelry",
    "covers": "Rings, necklaces, earrings, bracelets, charms & pendants, body jewelry, jewelry sets, anklets, brooches & lapel pins.",
    "decision_vectors": [
        {"id":"metal_type_hypoallergenic","label":"Metal type & hypoallergenic properties","why_it_matters":"Skin sensitivity/allergy is a common, decisive constraint (e.g. nickel-free requirement), not just a style choice.","how_to_evaluate":"Check metal composition against any known sensitivity.","data_source":"listing specs, user profile"},
        {"id":"size_fit","label":"Size fit (ring size / chain length)","why_it_matters":"The single largest return driver in this category, especially for rings.","how_to_evaluate":"Match listing's size options to the user's known ring size / preferred chain length.","data_source":"listing specs, user profile"},
        {"id":"gemstone_authenticity_certification","label":"Gemstone / material authenticity","why_it_matters":"For higher-value pieces, authenticity certification materially affects both value and trust.","how_to_evaluate":"Surface certification/authenticity documentation when present, especially above a price threshold.","data_source":"listing specs"},
        {"id":"occasion_symbolism","label":"Occasion & symbolism","why_it_matters":"Gift, engagement, and everyday-wear jewelry carry very different weight and expectations.","how_to_evaluate":"Match to the use case's stated occasion.","data_source":"use-case description"},
        {"id":"care_maintenance","label":"Care & maintenance","why_it_matters":"Plating wears off, stones need re-tightening — matters for total cost of ownership.","how_to_evaluate":"Surface plating type and recommended care.","data_source":"listing specs"},
        {"id":"price_tier","label":"Price tier / resale value","why_it_matters":"Extremely wide range from costume jewelry to fine jewelry with real resale value.","how_to_evaluate":"Filter to budget_tier; flag resale-relevant certification at higher tiers.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "For rings/chains, confirm exact size before anything else — it's the dominant return reason."
},
"footwear": {
    "label": "Footwear",
    "covers": "All Shoes leaves — athletic shoes, boots, flats, heels, sandals, slippers, sneakers — and Baby & Children's Shoes.",
    "decision_vectors": [
        {"id":"size_width_fit","label":"Size & width fit","why_it_matters":"The single dominant satisfaction/return driver in footwear; sizing varies significantly by brand and last shape.","how_to_evaluate":"Compare brand-specific size chart and width options to the user's known size/width.","data_source":"listing size chart, user profile"},
        {"id":"activity_use_case","label":"Activity use case","why_it_matters":"Running, dress, casual, and hiking shoes have essentially disjoint construction and performance needs.","how_to_evaluate":"Match to the stated activity in the use case.","data_source":"use-case description"},
        {"id":"material_breathability_weather","label":"Material & weather suitability","why_it_matters":"Breathability vs. waterproofing is a real tradeoff that needs to match climate/season.","how_to_evaluate":"Check upper material against scenario setting/season.","data_source":"listing specs, scenario slots"},
        {"id":"arch_support_comfort","label":"Arch support & comfort","why_it_matters":"Matters disproportionately for all-day wear or buyers with known foot conditions.","how_to_evaluate":"Surface insole/support claims, especially for daily-wear use cases.","data_source":"listing specs"},
        {"id":"durability_sole_quality","label":"Durability & sole quality","why_it_matters":"Sole material and construction quality drive both comfort and how long the shoe lasts under its intended use.","how_to_evaluate":"Check sole material and reviews for wear complaints.","data_source":"listing specs, reviews"},
        {"id":"growth_room","label":"Growth room (children's sizing)","why_it_matters":"For kids' shoes specifically, a small growth allowance extends usable life without harming fit.","how_to_evaluate":"Bias size selection slightly larger for a growing child.","data_source":"listing size chart, household context"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Wide range from basic to technical/performance footwear.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier","brand_prefs","household_size"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Confirm brand-specific size/width before anything else — this is the highest-return apparel category overall."
},
"shoe_care_accessories": {
    "label": "Shoe accessories & care",
    "covers": "Boot liners, gaiters, shoe covers, shoe grips, shoe inserts (arch supports, gel pads, heel cushions, anti-slip), shoelaces, spurs.",
    "decision_vectors": [
        {"id":"shoe_type_compatibility","label":"Compatibility with the target shoe","why_it_matters":"Inserts, laces, and liners need to fit a specific shoe type/size, not just the wearer.","how_to_evaluate":"Match product sizing/compatibility to the shoe it's meant for.","data_source":"listing specs, use-case context"},
        {"id":"material_function","label":"Material & function (cushioning vs. support vs. protection)","why_it_matters":"Different problems (comfort, arch support, weatherproofing, traction) need genuinely different products.","how_to_evaluate":"Match to the stated problem being solved.","data_source":"use-case description"},
        {"id":"size_fit","label":"Size fit","why_it_matters":"Wrong-sized inserts or covers are simply non-functional.","how_to_evaluate":"Match to shoe size.","data_source":"listing size chart, user profile"},
        {"id":"durability","label":"Durability","why_it_matters":"Consumable-adjacent category (laces, inserts wear out); replacement frequency affects value.","how_to_evaluate":"Check reviews for longevity.","data_source":"reviews"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Generally low-cost category where value/multi-pack pricing matters more than brand.","how_to_evaluate":"Compare price across equivalent options.","data_source":"listing pricing"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":[]},
    "best_way_to_buy": "Confirm compatibility with the specific target shoe before price or brand."
},
"general_clothing_accessories": {
    "label": "General small accessories",
    "covers": "Catch-all for pinback buttons, decorative fans, wristbands, fashion face masks, traditional clothing accessories, maternity belts & support bands, bridal accessories, baby & children's protective wear.",
    "decision_vectors": [
        {"id":"use_case_occasion","label":"Use case / occasion","why_it_matters":"This bucket spans genuinely different purposes, so matching the stated occasion is the primary signal.","how_to_evaluate":"Match listing description tightly to the use case.","data_source":"use-case description"},
        {"id":"material_comfort_safety","label":"Material comfort & safety","why_it_matters":"Several items in this bucket (support bands, protective wear) have real comfort or safety requirements, not just style.","how_to_evaluate":"Check material and any relevant safety claims.","data_source":"listing specs"},
        {"id":"size_fit_adjustability","label":"Size fit / adjustability","why_it_matters":"Where applicable (support bands, wristbands), fit affects whether the item functions at all.","how_to_evaluate":"Prefer adjustable options where sizing is uncertain.","data_source":"listing specs"},
        {"id":"style_coordination","label":"Style coordination","why_it_matters":"Most items here are meant to complement an outfit or event, not stand alone.","how_to_evaluate":"Match to any stated outfit/event context.","data_source":"use-case description"},
        {"id":"price_tier","label":"Price tier","why_it_matters":"Generally low-cost, occasional-purchase items.","how_to_evaluate":"Filter to budget_tier.","data_source":"user memory: budget_tier"}
    ],
    "personalization": {"durable_memory_inputs":["budget_tier"], "session_scenario_inputs":["setting"]},
    "best_way_to_buy": "Treat this as a long-tail bucket — lean on the use-case description more than on general preference signals."
}
}

def main():
    with open(LEAVES_PATH) as f:
        leaves = json.load(f)

    mapping = []
    counts = {}
    for l in leaves:
        arch = classify(l["path"])
        if arch is None:
            raise SystemExit(f"Unmatched leaf: {' > '.join(l['path'])} — add a classify() rule before regenerating.")
        counts[arch] = counts.get(arch, 0) + 1
        mapping.append({
            "path": " > ".join(l["path"]),
            "leaf": l["path"][-1],
            "product_count": l["value"],
            "archetype_id": arch
        })

    missing = set(ARCHETYPES) - set(counts)
    unknown = set(counts) - set(ARCHETYPES)
    if unknown:
        raise SystemExit(f"classify() returned archetype id(s) with no definition: {unknown}")

    archetypes_out = []
    for arch_id, spec in ARCHETYPES.items():
        leaves_here = [m for m in mapping if m["archetype_id"] == arch_id]
        archetypes_out.append({
            "id": arch_id,
            "label": spec["label"],
            "covers": spec["covers"],
            "leaf_count": len(leaves_here),
            "product_count": sum(m["product_count"] for m in leaves_here),
            "decision_vectors": spec["decision_vectors"],
            "personalization": spec["personalization"],
            "best_way_to_buy": spec["best_way_to_buy"]
        })
    archetypes_out.sort(key=lambda a: -a["product_count"])

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "archetypes.apparel.json"), "w") as f:
        json.dump({
            "department": "Apparel & Accessories",
            "source": "Category<>Count workbook, sheet 1 (Google product taxonomy)",
            "total_leaf_categories": len(mapping),
            "total_archetypes": len(archetypes_out),
            "archetypes": archetypes_out
        }, f, indent=2)

    with open(os.path.join(OUT_DIR, "leaf-mapping.apparel.json"), "w") as f:
        json.dump(sorted(mapping, key=lambda m: m["path"]), f, indent=2)

    print(f"wrote {len(archetypes_out)} archetypes covering {len(mapping)} leaf categories")
    if missing:
        print("WARNING: archetypes defined but unused:", missing)


if __name__ == "__main__":
    main()
