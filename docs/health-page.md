# Health Page

## Scope

The health page uses the food, exercise and weight tracking categories described
by Boohee Health as a functional reference, not its branding, artwork, private
food database, commerce, community or paid services.

Implemented: per-day nutrition summary, food search and manual entries, photo
recognition with editable confirmation, exercise and water logs, existing weight
history/chart, user-defined targets, menstrual records, bowel logs, overnight
sleep logs, and medical records. Health-habit creation and home entries have
been removed; existing check-ins remain editable in daily history.

The home layout follows the supplied reference: food search, weight-management
band, food/exercise summary, and a two-column record grid. Empty cards show no
fabricated measurements. The existing bottom add control follows the current
view; on the home page it opens the record menu.
The home has no date selector and always summarizes today. Date queries belong
to individual detail views (and independently to each medical tab). Nutrition,
water and daily history default to today; other record lists default to all dates
and allow clearing the date filter. Period queries match the recorded date span.
Weight date queries filter the record list; the overall trend and latest-weight
summary remain unchanged. New records default to today, never the queried date;
users may still change the date in the editor.
Sleep intervals cannot overlap or exceed 24 hours; identical habits cannot be
checked in twice on one date. All three new record types support edit/delete.

Checkups, medical visits and vision examinations share one Health Archive home
entry, with Checkup, Medical Visit and Vision tabs. The bottom add button and inline add button create the
active tab's record type. Returning home and reopening preserves the selected
tab during the current page session. The home add menu also links to this archive.
Report attachments reuse owner-scoped photo storage (up to six images, no PDF
support in this version). Reports are sent to AI only through the explicit,
separately consented transcription flow described below. Visit follow-up times reuse
native local notifications and foreground web reminders; permission is required
for native delivery. Notification text omits clinical details. These records
remain outside assistant context and `/api/state`.

Vision records require only the examination date. Institution, left/right
unaided and corrected acuity, sphere, cylinder, axis, pupillary distance, notes
and photos are optional. Values retain the report's notation and signs without
conversion or interpretation. The editor uses five short steps; histories sort
by examination date. No diagnosis, treatment advice or automatic reminders are
generated from these values.

New Checkup, Medical Visit and Vision forms offer camera/album transcription.
`POST /api/health/medical-recognize` requires authentication, `consent: true`, a
supported kind and a validated image; per-account rate limits apply. The
configured AI provider must support image input. Only whitelisted draft fields
are returned, not arbitrary model fields, follow-up dates or identifiers.
Uncertain/missing dates remain blank and require correction.

Recognition does not create entries or upload photos to account storage.
Users review and edit the result before saving; cancellation discards the
draft. A separate checkbox controls attaching the source photo on save.
Provider processing/retention follows its own policy and is disclosed before
transmission. The app stores no report in chat history and runs no AI tools.
Accuracy is not guaranteed: signs, laterality and values require user review.

The bundled catalog is a starter list of 12 foods plus the user's saved foods.
It is not a comprehensive branded-food database. Food preparation and serving
weight affect nutrition. Catalog weights are grams, including milk.

## Nutrition Provenance

Source: USDA FoodData Central, SR Legacy, fetched 2026-10-09:
`https://api.nal.usda.gov/fdc/v1/foods`

FDC IDs and the exact English source descriptions:

| ID | Description |
| --- | --- |
| 171688 | Apples, raw, with skin (Includes foods for USDA's Food Distribution Program) |
| 173944 | Bananas, raw |
| 168878 | Rice, white, long-grain, regular, enriched, cooked |
| 173424 | Egg, whole, cooked, hard-boiled |
| 171477 | Chicken, broilers or fryers, breast, meat only, cooked, roasted |
| 171265 | Milk, whole, 3.25% milkfat, with added vitamin D |
| 170379 | Broccoli, raw |
| 173904 | Cereals, oats, regular and quick, not fortified, dry |
| 169910 | Mangos, raw |
| 168482 | Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program) |
| 169247 | Lettuce, cos or romaine, raw |
| 172183 | Egg, white, raw, fresh |

Nutrients 1008, 1003, 1004, 1005 supply kcal, protein, fat, carbohydrates per 100g.
Entries store nutrients for the entire portion, not per 100g.

## Privacy and Safety

- `health_entries` and `health_settings` are account-scoped SQLite tables.
  Foreign keys cascade when an account is deleted.
- They are not added to `/api/state` or the assistant conversation context.
  Existing weight records retain their existing behavior.
- Gender reuses `/api/account/profile`. Unset gender prompts on menstrual entry;
  female enables it, male hides it. Changing gender does not delete history.
  The server independently enforces these gates.
- Menstrual dates record actual events only; no fertility, contraception or
  disease predictions. Overlapping/open-ended duplicate periods are rejected.
- No automatic calorie prescription. Minors cannot set calorie or weight goals.
- Photo upload requires explicit consent. The application forwards the image to
  its configured AI provider without persisting the original. Provider retention
  is subject to its own policies. Recognition does not save a health entry.
- AI nutrition/portions are estimates. Unknown numbers remain blank for review.
  Save requires an explicit action, with retry deduplication and revision checks.

## Verification

`node --test tests/health.test.mjs tests/app.test.mjs`

`node scripts/smoke-health.mjs` uses a temporary database and a controlled AI
provider. It covers real HTTP saves, isolation, gender flow, photo consent,
recognition errors and confirmation, edits/deletes, legacy weights and responsive
screenshots. It does not claim real-phone or AI recognition accuracy validation.
