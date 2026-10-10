# Device Sync Foundation

The health home links to Device and Data Sync. Xiaomi, Huawei and Apple are
listed as unavailable; no SDK, OAuth flow, Bluetooth connection or native health
permission is implemented. Manual sync remains disabled.

Authenticated `GET /api/health/sync` and `PUT /api/health/sync` load and save
account-scoped metric preferences (steps, heartRate, sleep, exercise, weight).
PUT requires the current integer revision. Unknown fields, including provider
tokens and attempted authorization changes, are rejected.

`health_sync_preferences` stores preferences only, with a cascading user foreign
key. It does not store health samples. Cloud authorization is always false and
last-sync timestamps are always null. Preference selection is not consent.
These settings are not added to the assistant context.

Before enabling a provider, implement real eligibility checks, platform
authorization, separate informed cloud consent, sample validation and
deduplication, revocation, and deletion of imported data. Neither Android nor
iOS currently imports device health data.

Verification: `node --test tests/*.test.mjs`, web build, and
`scripts/smoke-health.mjs` (isolated backend with fixture accounts). The browser
test checks preference persistence, unavailable state and responsive layouts.
