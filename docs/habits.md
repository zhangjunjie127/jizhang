# Habit Goals

The habit view keeps the existing account-scoped `planner_items` and
`planner_checks` tables. Existing habits retain their weekly schedule and
check-in history. New settings live in the existing JSON payload; no table
replacement or destructive migration is required.

## Recurrence

The recommendation sheet contains 50 editable presets across health, study,
exercise, home, work and relationships. Selecting one fills its schedule,
reminders and focus settings without saving; existing dates and notes remain.
Medication presets deliberately leave reminder times unset.

- `weekly`: selected weekdays, Monday = 0.
- `monthly`: selected calendar days 1-31. Missing days are skipped, not shifted.
- `week-flex` / `month-flex`: a target count of distinct check-in days per
  calendar week/month. Dates are chosen by the user, not randomly generated.
- `startDate` and `endDate` are inclusive. A blank end date is unlimited.
- Legacy blank start dates fall back to the creation date.
- `skipHolidays` excludes published rest days, not every weekend. Adjusted
  workdays remain subject to the selected recurrence. Unknown future holiday
  schedules are not invented.
- All calendar boundaries and reminders use Asia/Shanghai.
- A schedule edit preserves historical checks; users can undo a prior check
  even if that day no longer belongs to the updated schedule.

## Focus

Focus duration is 1-180 minutes. The timer uses a timestamp deadline rather
than decrementing a counter, and supports pause, resume and explicit early
termination. Completing the timer submits an idempotent check-in for the
original date; early termination never checks in.

An account-scoped local session survives reload. When the planner is reopened,
an elapsed session finishes its check-in. A closed browser cannot run the
timer's completion request until the app is reopened. Failed submissions
remain visible with a retry action.

## Reminders

Each goal supports up to eight distinct 24-hour times. Completed days and
fulfilled flexible periods are excluded.

- Android uses the existing Capacitor local-notification integration. Task
  reminders and habit reminders are synchronized together so one does not
  cancel the other. The next 30 days (up to 256 habit notifications) are queued
  and refreshed while the app is active. Notification permission is required;
  system battery restrictions may affect delivery.
- Web polls while the authenticated application is open and shows in-app
  reminders, plus browser notifications when allowed. It does not claim to
  deliver notifications after the browser is closed. This limit is shown
  when a reminder is saved.
- Reminder failures do not roll back a saved goal.

## Verification

`node --test tests/*.test.mjs` covers validation, old records, recurrence,
month/year boundaries, holidays, reminders and account isolation.

`scripts/smoke-planner.mjs` uses a temporary account and database to exercise
recommendation sheets, icons, recurrence controls, saved settings, focus
pause/stop/automatic completion, statistics, old features and responsive
screenshots. It does not modify real account data.
