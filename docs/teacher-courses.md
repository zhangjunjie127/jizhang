# Teacher Courses

- The weekly template stores subject, class, teacher, room, weekdays, period
  and recurring notes. Course screens do not offer camera, upload or photo UI.
  Legacy photo IDs are preserved during edits; task photo features are unchanged.
- "My teaching" only shows the saved teacher's actual lessons, counts and relevant
  conflicts/history. Without a saved identity the empty grid remains; clicking a
  cell first confirms a teaching name, then opens creation for that same slot.
  It never shows other teachers as a fallback. Identity is configured in "Timetable and reminders".
  New courses prefill this name; existing teacher assignments are not changed.
- "Class timetable" requires selecting one class; there is no all-classes view.
  Until selection, an empty weekly grid remains while daily statistics are hidden.
  Empty cells open creation with weekday and period prefilled; the selected class
  is carried over. Creating a class course selects its saved class. Lessons,
  statistics and history follow that class. Old courses without a class use the
  unassigned option.
- Seven sample periods are offered, but the user must confirm their times.
  Editing the timetable clears confirmation and disables reminders.
- A lesson adjustment is scoped to a course ID and its original date. Date,
  period, substitute teacher, room, cancellation, notes and attachments are
  append-only events. Each save checks the previous event ID. Retrying the same
  request ID does not duplicate the event.
- Cross-week moves appear on the destination date and disappear from the source.
  Recurring templates are not changed. A later restoration is another event.
  Cancelled lessons can be reopened from the change history.
- Conflicts are advisory: overlapping period/date with a shared nonempty teacher,
  class or room. They do not silently overwrite or delete a course.
- Today's counts and current/next lesson use Asia/Shanghai and the confirmed bell
  schedule. Periods without a configured bell have no inferred reminder time.
- Reminder delivery reuses the shared notification channel and phone ringtone
  settings. Only the configured teacher's lessons remind. Native scheduling
  prepares up to 30 days (capped at 256 course reminders) on sync; web delivery
  requires the application to be open. Actual Android alarm/ringtone delivery
  still requires device verification.
- Photos reuse the owner-scoped task-photo store; records and events store IDs,
  never image data. Account deletion cascades through settings and course events.
