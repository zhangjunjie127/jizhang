# Remediation Status

Updated 2026-10-22. This list separates implemented fixes from work that needs
external access, a product decision, or physical hardware. Automated tests do
not count as device or production acceptance.

## Completed In This Pass

- Full account JSON export is available in account settings and is account-scoped.
  It includes account-owned records, chats, memories, health entries/settings,
  health-sync preferences, report/task photos, planner/course data, debts,
  feedback and assistant audit history. It excludes password hashes, login
  sessions, temporary action authorizations and device-local preferences.
- Android saves JSON through the system document picker; browser clients use a
  normal file download.
- Manual SQLite snapshot and guarded restore commands are available. Snapshots
  are integrity-checked; restore requires explicit stopped-server and overwrite
  acknowledgements and preserves the current database first.
- Corrected the stale README entry that said Android desktop widgets were not
  implemented. They exist, but still need physical-device validation.

## Still Open

### P0 - Before Sharing With External Testers

- **Rotate the provider API key that was shared in conversation.** This must be
  done in the issuing gateway/account dashboard; the repository cannot revoke
  the remote credential. After rotation, replace the local encrypted credential
  and verify that the old credential is rejected. Do not put the new key in
  source, APK, logs, or chat.
- **Use HTTPS for the app backend and AI gateway.** The current private test
  setup uses HTTP and this workspace has no domain, TLS certificate, reverse
  proxy, or deployment credentials. Configure these in the chosen hosting
  environment, then verify login, file export, AI, and notifications end to end.
- **Protect backups at rest and off-device.** Manual snapshots and account JSON
  exports are currently unencrypted and local-only. Encryption requires a
  separately managed recovery key; automated off-site copies require a trusted
  storage target and retention policy. Do not enable blind cloud copying.
- **Verify production account and age controls.** Birthday is self-reported;
  no identity/age verification provider or legal/privacy policy is configured.
  Public intimate-mode use must remain disabled until a compliant verification
  flow and safety review exist.

### P1 - Requires Providers, Platform Access, or Product Decisions

- **Health-device import (Xiaomi, Huawei, Apple):** only provider selection and
  preferences exist. Real access needs each platform's SDK/OAuth entitlement,
  app registration, Android/iOS permissions, consent/revocation handling, data
  mapping and tests on supported devices. No provider credentials are present.
- **AI greetings while the app is closed:** requires a reachable HTTPS backend,
  push credentials and registered FCM/APNs applications, plus user opt-in,
  delivery/retry handling, and device tests. Local reminders are not a substitute.
- **Offline record creation and conflict sync:** needs a durable local queue,
  idempotent replay, conflict-resolution behavior and account-switch cleanup.
  This is not safe to bolt on without specifying merge semantics; currently
  manual writes require the backend.
- **Budgets, transfers/refunds, recurring bills, multi-ledger, import/dedup and
  AI reports:** not implemented. Each changes accounting semantics and needs
  explicit rules for balances, reversals, recurrence, duplicate detection and
  historical migration before implementation.
- **Automatic recycle-bin cleanup:** needs a retention period and user-visible
  recovery promise. No deletion interval was specified; records currently remain
  recoverable until manually removed by an administrator/database operation.
- **Account binding and self-service recovery:** phone, email and WeChat require
  SMS/email/identity providers and anti-abuse controls. They remain unavailable;
  password change works only while the current password is known.
- **Full iOS parity:** the project has iOS/widget scaffolding, but Android-only
  floating assistant, app lock/biometrics, document export, notification bridge
  and calculator need iOS implementations or explicit alternatives. This
  Windows host cannot sign/build iOS; Apple hardware, Xcode and signing access
  are required.

### P1 - Physical Device Acceptance

- Android microphone/speaker echo behavior, overlay permission and lifecycle,
  keyboard/rotation, lock screen, notification timing, file picker, vibration,
  app lock and screen-capture protection still require a physical Android device.
- Android/iOS widgets require installation, launcher pinning, account switching,
  privacy masking, cold/warm taps and background refresh checks on each platform.
- Push delivery, battery restrictions, force-stop behavior and long-call stability
  vary by OS and device; browser mocks cannot certify them.

### P2 - Performance And Operations

- Production build succeeds, but Vite reports the assistant JavaScript chunk
  exceeds 500 KB. Profile first-load and low-end Android performance before
  deciding code-splitting boundaries.
- SQLite remains single-instance storage. Multi-instance coordination, load
  capacity, long-call stability and a latency SLO have not been established.
- Payment remains intentionally disabled. Enabling it requires a payment
  provider, server-side reconciliation, refunds, abuse controls and operational
  review; a UI-only success state is not acceptable.

## Verification Record

- `pnpm test`: 204 tests passed, 0 failed on 2026-10-22.
- `pnpm run build`: passed on 2026-10-22. Vite still reports the assistant chunk
  above 500 KB; this is an optimization warning, not a build failure.
- On Windows, set `$env:ANDROID_HOME = (Resolve-Path '.tools/sdk').Path`, then
  run `.\android\gradlew.bat -p android compileDebugJavaWithJavac --no-daemon --offline`:
  passed on 2026-10-22. No APK was packaged and no device was connected.
- Account export tests cover authentication, account isolation, health data and
  credential exclusion.
- Backup tests cover snapshot consistency, integrity rejection, explicit restore
  safeguards and preservation of the pre-restore database.
- Real AI calls, production credentials, Android physical hardware, iOS hardware,
  push providers and payment providers were not exercised in this pass.
