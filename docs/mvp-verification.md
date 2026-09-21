# MVP verification - 2026-09-16

## Passed

- Node test suite: 14 tests, including account isolation, minor/adult relationship
  boundaries, password verification, integer-cent accounting, pending-only AI
  records, idempotent confirmation, record corrections, shared history across
  persona changes, and clearing history without removing utility records.
- Production frontend build with Vite.
- Android debug APK build with Gradle 8.2.1 and Android SDK 34.
- APK v1/v2 signature verification; packaged text assets did not contain the
  supplied CPA credential or upstream IP address.
- Browser UI smoke tests at 1366x900, 390x844, and 320x740.
- Real text-model call saved a user preference through the memory tool.
- Real text-model call proposed an 18-yuan expense without confirming it.
- After a persona switch, the model accurately recalled the saved preference.
- Real realtime output produced Chinese transcript and PCM audio.
- Explicit response cancellation returned the upstream `cancelled` status.
- Synthetic speech passed through the app relay and returned input transcript,
  assistant transcript, and output audio.
- Browser fake-microphone testing exercised recording, resampling, audio relay,
  playback, transcript display, cancellation dispatch, and item truncation.
- Nonblocking call controls: switched to the ledger and confirmed an expense
  during a live call; sent typed input through the same realtime connection.
- Repeated call-button clicks did not create a second active connection.
- Ended a call, started another, and reloaded the page; earlier messages remained
  in the same chat timeline without duplicates.
- Mobile screenshot checks verified the call dock did not cover the composer
  or bottom navigation; desktop used the same shared-history layout.

## Not established

- Android physical-device microphone, speaker echo cancellation, and notification
  delivery. No authorized Android device was connected during development.
- Persistent background AI-message push when the app is closed.
- Production age verification, encrypted deployment, billing, or payment.
- Load capacity, long-call stability, or a guaranteed latency budget.
- Quality of autonomous multi-day follow-up in real daily use.

## Persona voice revision (2026-09-16)

- Replaced the shared `marin` voice with `sage` (gentle), `ash` (blunt),
  and `verse` (witty). Shared instructions now specify standard Mandarin;
  each persona has its own wording, rhythm, and delivery instructions.
- Safety and pending-record confirmation remain shared across personas.
  Distress suppresses sarcasm without requiring identical dialogue styles.
- All 15 automated tests passed, including three consecutive calls with
  different upstream voice settings and preserved chat history.
- `node scripts/probe-personas.mjs` generated real audio through the existing
  CPA connection. All three session responses echoed the requested voice,
  returned audio and transcripts, and completed successfully.
- Samples and transcripts: `artifacts/personas/`. These are generated test
  replies to the same synthetic input, not preset app dialogue.
- Mandarin accent, naturalness, and perceived voice contrast require human
  listening. Transport success does not establish pronunciation quality.
- Backend-only change; no new APK is required for this revision.

## Deliverables

- `artifacts/zaizai-mvp-debug.apk`
- `artifacts/today-desktop.png`
- `artifacts/today-mobile.png`
- `artifacts/voice-mobile.png`
- `artifacts/voice-browser-report.json`
- `README.md` with startup and USB-forwarding instructions.

The `experience` account is an internal test account with synthetic records and
real AI-generated replies to test inputs. It is not the user's personal history.

## Bookkeeping stage 1 (2026-09-16)

Implemented:

- One-step explicit manual save, retry-safe request IDs, editable AI drafts,
  multi-record proposals and version-checked pending-draft corrections.
- Transactional batch confirmation with validation, ownership checks, rollback,
  and idempotent retries. Unconfirmed items are excluded from reports and export.
- Confirmed-record editing, recoverable deletion and a user-isolated recycle bin.
- Month/direction/category/text filters, integer-cent totals and category
  drill-down. Category charts collapse to leave room for the ledger on phones.
- Filtered CSV export with UTF-8 BOM, quoted fields and spreadsheet formula
  neutralization. Android uses an app-local Capacitor plugin and the system
  document picker; no new npm dependencies.
- Removed the 1000-record snapshot truncation. This private MVP still returns
  full datasets; large-account pagination remains future work.

Verification:

- 22 automated tests passed. The realtime relay integration test also exercises
  multi-record tool calls, invalid-batch rollback and refusal to alter confirmed
  records through the AI correction tool.
- `scripts/smoke-ledger.mjs`: one-step save, batch editing and confirmation,
  amount correction, recycle-bin recovery, filtering, export and reload.
  Screens checked at 1366, 390 and 320 pixels; mobile batch dialog tested too.
- `scripts/smoke-ledger-ai.mjs`: two real GPT calls generated three correctly
  categorized drafts and changed the original lunch amount from 28 to 18;
  the drafts remained pending until a separate authenticated confirmation.
- Real CPA browser voice regression passed: input/output, interruption,
  nonblocking ledger, typing during the call and shared history after redial.
- Vite production build and Android debug APK build succeeded.
- Tests created synthetic `ledger-ui-*` and `ledger-ai-*` accounts with proactive
  messages disabled. These are test fixtures, not personal financial records.

Evidence: `artifacts/ledger-ui-report.json`, `artifacts/ledger-ai-report.json`,
`artifacts/voice-browser-report.json`, `artifacts/ledger-*-v2.png` and
`artifacts/ledger-batch-mobile.png`.

Limits: no connected Android device, so actual system document-picker saving,
hardware audio and notification delivery remain unverified. No budget,
account/transfer/refund model, import, full-backup restoration UI or offline
record queue is included in this stage. A pre-migration SQLite backup was made
under `data/backups/`; CSV alone cannot restore the entire application.

## Navigation and visual revision (2026-09-16)

- Replaced combined pages with five direct destinations: companion, tasks,
  ledger, health and account. The last selected destination persists.
- Ledger uses a yellow summary band, white dated rows, category icons and
  separate detail/statistics tabs. Visual reference was the official Shark
  Accounting iPhone listing; no reference branding or assets were copied.
- Each tool displays only its own pending drafts and opens its own form.
  Chat retains the shared queue and shared conversation history.
- Mobile entry actions remain above navigation and move above the active
  call dock. No database reset or server-address migration was performed.

Verification:

- 25 automated tests passed, including module draft isolation, route
  compatibility and UUID generation on LAN HTTP.
- `smoke-ui.mjs` and `smoke-ledger.mjs` passed at desktop and mobile sizes
  (1366, 390 and 320 pixels), covering forms, editing, confirmation,
  deletion/restoration, filters, export and reload.
- Real-provider browser voice regression passed with a simulated microphone:
  audio/transcripts, interruption, typing and ledger use during calls,
  and shared history across calls and reload.
- Evidence: `artifacts/navigation-*.png`, `artifacts/ledger-ui-report.json`
  and `artifacts/voice-browser-report.json`.
- No connected Android device: native rendering, hardware audio and touch
  interaction still require device verification.

## Context-aware proactive check-ins (2026-09-17)

- Persistent per-user delivery log enforces at most three proactive messages
  per Shanghai calendar day, at least three hours apart, quiet hours
  21:00-08:00, pause/disable settings and no follow-up to an unanswered nudge.
- Candidate selection considers upcoming/recently overdue tasks, missing
  evening ledger entries (pending drafts count), unplanned matters and memories.
  The real text model selects one topic or abstains based on conversation.
- No tools are enabled for check-in generation. Replies follow the existing
  draft/confirmation workflow. Unchecked tasks are not assumed unfinished,
  and missing ledger entries are not assumed to be actual spending.
- Recent conversation suppresses check-ins for one hour. State and settings
  are rechecked after generation; concurrent edits, replies and calls cancel
  stale delivery. Attempts are throttled to 30 minutes and 12 per day.
- New check-ins appear in the existing conversation, with a read/unread badge.
  No background AI push was added: the server must run, and an open app polls
  for messages. Previously scheduled Android task notifications are separate.
- Unit/runner tests cover quotas, races, abstention, persistence, topic
  deduplication and account isolation. `scripts/probe-checkin.mjs` uses real GPT
  with explicitly simulated evening scenarios: missing-ledger send and
  already-answered/task-done skips passed. This is not a full-day timing test.
- The SQLite database was backed up before the additive checkins-table
  migration. The LAN service was restarted with the existing CPA provider.

## Assistant receipt recognition (2026-09-17)

- Renamed the companion entry to assistant without resetting personality,
  memory, conversation or financial data.
- Camera/album input converts images to bounded JPEG data, stripping original
  metadata; the authenticated backend validates MIME signatures and size,
  rate-limits requests, and sends image content to the configured text model.
  The model receives no tools and OCR itself writes no financial record.
- Recognition results require explicit review. Unknown dates/amounts/quantities
  remain blank; line totals and signed order adjustments must exactly equal
  the paid total in integer cents. Only CNY receipts are supported.
- One confirmed expense embeds item details grouped by category, retained on
  reload/edit. Overall ledger reports/CSV count one transaction using its
  parent category. No allocation of order discounts across item categories.
- Idempotent save and per-account normalized-image hashes prevent the same
  image being confirmed twice, including confirmation/batch/restore routes.
  Different photos or crops of the same receipt are not semantically deduped.
- Original images are not persisted. Records retain structured line items,
  not OCR image content or model warnings after the user's explicit review.
- 47 automated tests passed, including mock upstream image transport,
  read-only recognition, mismatch rejection, one-row export, duplicate
  prevention and retained details.
- `scripts/smoke-receipt-ui.mjs` used a generated test-only receipt image
  through the real configured model: two product categories, a discount,
  manual review, one expense, reload, and duplicate-image rejection passed.
  This does not establish accuracy on arbitrary real-world blurry receipts.
- Android reuses Capacitor's camera/file-picker flow with the camera intent
  visibility declaration. Physical camera capture remains unverified without
  an attached Android device.

## Personal debt management (2026-09-17)

- The ledger header opens a fullscreen personal-debt view. Receivables and
  payables are separate; mortgages, credit cards and consumer-credit products
  are not modeled.
- Three additive SQLite tables preserve counterparties, individual loan bills
  and repayment history. Same-name counterparties are grouped per account;
  repeated loans remain independent. Original borrowing does not generate ledger records.
- Integer-cent validation, account-scoped reads/writes, atomic balance checks,
  optimistic revisions and request-id replay protection guard financial writes.
- Repayments cannot exceed the selected bill balance or precede its loan date.
  Backdated valid repayments recalculate the chronological running balances.
  Voids retain original entries, reasons and timestamps rather than deleting them.
- 55 automated tests passed. An isolated real-backend browser test covers two
  loans for one person, partial repayment of one loan, opposite-direction
  balances, settlement, repayment reversal and reload persistence at
  320/390/1366px. Existing ledger layout and period-switch checks also passed.
- The existing SQLite database was backed up before adding the debt tables.
  After restarting with the existing provider configuration, existing-account
  login and authenticated debt reads passed; original user/record/message counts
  were unchanged. No debt test records were written to the live database.
- This delivery updates the web preview and service; Android hardware behavior
  and a newly installed APK were not verified in this change.

### Received Repayment Income

- New receivable repayments generate one confirmed income record categorized as
  `收回借款`, dated on the actual repayment date. The agreed due date is unchanged.
  Old repayments are not backfilled; payable repayments remain ledger-independent.
- An additive nullable ledger-record link preserves existing payment data.
  Income creation, repayment creation and bill revision update share one transaction.
  Replayed requests do not create a second income; failure rolls back both sides.
- Reversing a repayment reverses its linked income and restores the bill balance.
  Linked income cannot be separately edited, deleted, rejected or restored.
  Reversal history stays in the debt bill, not the ordinary ledger trash.
- The confirmation form shows the original due date, actual repayment date,
  income amount and remaining balance. Income entries open their original bill.
  The ledger updates immediately without a page reload.
- Verification: 58 automated tests and production build passed. The isolated
  browser flow passed at 320/390/1366px, including immediate income visibility,
  opening the source bill, reversal and unchanged due dates.
- Live database backed up before migration. Preview-proxy health, existing
  account login and debt reads passed after service restart. User/record/message/
  bill/payment counts remained 12/70/149/1/0; no live repayment was created.

## Blue Theme and Statement Pages (2026-09-17)

- The home ledger remains intact. Annual and monthly buttons now open separate
  statement views, with a balance summary and aligned income/expense/net columns.
  Annual rows drill into the selected year's months; monthly rows open dated
  entries with all/income/expense filters. Returning preserves year selection.
- Only confirmed, undeleted ledger records count. Integer-cent tests cover
  year boundaries, empty periods, negative balances and million-scale amounts.
  The current year/month remains visible without data; historical periods are
  included when they contain records. Large figures stay on one line in `万`.
- Blue/white replaces yellow primary surfaces, buttons, tabs and chat accents.
  Category colors, green active microphone and semantic status colors remain.
- Income now includes `债务`, exclusively for received repayments. Selecting it
  opens a receivables-only debt flow to select the person and original bill.
  Existing stored `收回借款` categories are displayed/filtered/exported as `债务`
  without rewriting records or creating additional income.
- 61 automated tests and the production build passed. Statement screenshots and
  browser flows passed at 320/390/430px, including historical-year selection,
  month details, income filtering, zero-data and million-amount layouts.
  Entry, debt, preview-keyboard and microphone smoke tests also passed.
- The isolated real-backend debt test verifies income-category entry and the
  1000 -> received 500 -> remaining 500 scenario, with an unchanged due date.
  No financial test data was written to the live account.
- The live database was backed up and the backend restarted with its existing
  AI settings. Preview-proxy health, account login, debt reads and ledger export
  returned success. Counts remained 12 users, 70 records, 149 messages, 1 debt
  bill and 0 repayments. Android installation/hardware was not tested here.

## Assistant Repayment Path (2026-09-17)

- Root cause: the previous repayment integration only covered manual entry.
  Assistant tools could create ordinary income but had no debt-repayment intent
  or confirmation path to an original bill.
- Added `propose_debt_repayment`, shared by text completion and realtime tools,
  with required counterparty, amount and actual date. User debt context is
  account-scoped. The tool only creates a pending `debt_repayment` record.
- The review window requires selection of an original receivable bill; multiple
  bills are never auto-selected. It shows actual date, unchanged due date,
  original/current balance, income and remaining balance before confirmation.
- Confirmation consumes the draft, creates one linked income, records the
  repayment and updates the bill revision in one transaction. Tests cover stale
  drafts, payable bills, other accounts, rollback and retries. Generic and batch
  confirmation cannot bypass this path. Equivalent pending AI drafts are reused.
- Real configured AI verification passed through the browser: sending
  “测试张三昨天还给我500元，帮我记录还款。” produced a repayment draft dated
  September 16, 2026, not ordinary income. A 1000-yuan bill and an 800-yuan bill
  required manual selection; confirmation changed only the selected bill to
  500 yuan, retained its due date and produced exactly one 500-yuan income.
- This real-AI check used an isolated temporary backend/database and the
  existing configured provider, not the live account. Fixture browser tests
  passed at 320/390px. Realtime protocol tests cover tool dispatch, confirmation
  during a call and duplicate tool events; this is not live microphone testing.
- 64 automated tests and production build passed. The live database was backed
  up before service restart. Login, health and debt reads passed; counts stayed
  12 users, 71 records, 168 messages, 1 bill and 0 repayments. Old unlinked income
  was not rewritten. Homepage entry order is now monthly, annual, debt.

## Assistant Authorization (2026-09-17)

- Added account-scoped read tools and a closed operation allowlist covering
  record confirmation, edits, trash/restore, task completion, personal debt
  creation/repayment/reversal/void, memories and assistant preferences.
  There is no model-facing execute tool, URL fetch, export/share, provider
  configuration or phone-control tool.
- The backend validates a proposed operation in a rollback-only savepoint and
  generates the exact summary. Confirmation is bound to that stored operation,
  the account's data fingerprint and a five-minute expiry. Changed data,
  replacement, cancellation or ambiguous replies cannot authorize the old plan.
  Execution and its audit receipt commit together; retries do not repeat writes.
- Confirmation can come from a review button, exact typed confirmation or real
  audio transcription. The voice gate requires a complete matching summary and
  a client playback-finished acknowledgment before the user's speech begins.
  Interrupted playback and partial summaries do not authorize execution.
  Simplified/traditional forms of the explicit confirmation words are equivalent;
  other recognition errors are not interpreted as consent.
- Real-provider tests exposed paraphrasing of financial summaries; the review
  response now reads fixed text with tools disabled. A short synthetic utterance
  was misrecognized and correctly did not execute. A subsequent full synthetic
  "confirm execution" utterance passed through the real realtime model and
  transcription service and changed the reviewed expense from 18 to 19 yuan.
  Playback acknowledgment was simulated in that transport test. Separate
  VoiceCall tests verify waiting for the playback queue and interruption behavior.
  This is not Android hardware or human-microphone acceptance testing.
- Real text-model/browser tests passed: new expense draft -> typed confirmation;
  confirmed expense edit -> button confirmation; 1000-yuan receivable -> received
  500 -> remaining 500 plus one income on the actual date, unchanged due date;
  repeated confirmation and cancelled deletion do not make additional changes.
  All these tests used isolated temporary databases and synthetic records.
- Fixture browser flows passed at 320/390px without horizontal overflow. The
  existing multi-bill repayment-selection regression also passed. Screenshots:
  `artifacts/assistant-authority-fixture-320.png`,
  `artifacts/assistant-authority-live-390.png`.
- 74 automated tests and the production build passed. Backed up the live DB to
  `data/backups/before-assistant-authority-1789643140157.sqlite`, restarted the
  backend with the existing provider settings, and verified proxy health/login/
  debts all return 200. Domain counts stayed at 12 users, 71 records, 168
  messages, 1 debt bill, 0 repayments; no live-account financial test writes.
- Payments, account security and clearing all conversation history remain
  explicit manual flows, not assistant operations. The existing manual history
  clear also removes authorization audit rows; records and debts remain.

## Inline Ledger Views (2026-09-18)

- Default ledger view is details. A persistent details/month/year tab strip
  switches one inline panel without dialogs, duplicated report navigation or
  return buttons. Main heading and bottom navigation remain visible.
- Annual rows select the year and switch to the monthly tab; monthly rows
  switch to details filtered to that month. Details include month/day selection,
  search, income/expense and category filters. Direct tab switches preserve
  details filters and the monthly report's year selection.
- Category statistics, debt, export and trash remain available from details.
  Today/yesterday labels and per-day income/expense totals remain in the list.
- Updated browser regression passed at 320/390/430px, covering default details,
  fixed tab position, no dialogs, year-to-month-to-details navigation, retained
  filters, selected-day queries, million amounts, empty states and debt entry.
  74 automated tests and the production build passed. No backend/database
  changes or live financial test writes were needed.

### Debt Tab Follow-Up

- Added debt as the fourth persistent top tab and removed its old detail-toolbar
  icon. DebtManager reuses its existing logic in an inline presentation for all
  list/detail/form states, with local back navigation and no dialog/close layer.
  The income-category and linked-record modal entry points remain unchanged.
- Saving disables switching ledger tabs until the request completes. Linked
  repayment income still updates the parent ledger and active voice context.
- Inline forms reuse the phone-preview numeric/text keyboard; actual phones
  continue using native input. Inline screen changes scroll to the page top.
- Isolated-backend browser regression passed at 320/390/430px: independent
  loans, partial repayment, overpayment rejection, income synchronization,
  settlement/reversal, search/persistence and preview keyboard visibility.
  Monthly/yearly tab regression, 74 automated tests and build also passed.

### Unified Date Selector

- Replaced separate native month/day inputs with one compact date trigger.
  Opening it selects a month first, then shows that month's calendar inline.
  Selecting a day closes the panel; "view whole month" removes only the day
  constraint and preserves search/category/direction filters.
- Calendar uses built-in Date operations, Monday-first alignment, fixed six-week
  rows, year navigation and disabled future dates/months. Escape, close and
  outside clicks dismiss the panel. Panel scroll margin keeps the whole-month
  button above mobile navigation and the active-call dock.
- Browser tests passed at 320/390/430px for month-to-day switching, actual
  filtering, whole-month selection, no horizontal overflow, footer visibility,
  leap/non-leap February, future-date guards and dismissal. Production build
  passed. Test fixtures did not modify live records.
