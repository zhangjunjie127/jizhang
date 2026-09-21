# Task Trace And Reminders

Creation time comes from the existing server-owned `created` field; edits do
not rewrite it. `occurredDate` is an optional backfill date independent of
`date`, `scheduledDate`, and `due`. Old records have no inferred occurrence date.

`reminderRepeat` defaults to `once`. Weekly and monthly reminders use
`reminderDays` (weekly: Sunday=0 through Saturday=6; monthly: 1-31) and share
the Shanghai clock of `due`. Existing records without `reminderDays` keep the
weekday/day of their original `due`. Missing month days are skipped.
The editor uses multi-select weekday/day buttons plus a time-only wheel for
repeats, and full date/time wheels for single reminders. The original anchor
date is retained on edit; new recurring reminders start no earlier than today.
Completion stops further reminders; recurrence does not create duplicate
tasks, reset completion, or change the original reminder timestamp.

Android schedules the next 30 days when synchronized, using the shared
system notification channel. Reopen the app to refresh that window. Web
checks once every 20 seconds while open, deduplicating occurrences locally;
closed-browser delivery is not supported. This change is not yet packaged
or tested on an Android device.
