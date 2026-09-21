# Shared Reminder Sound

Settings includes a Reminder Sound entry for all scheduled reminders.

On Android 8+, `ReminderSoundPlugin` opens the OS settings for the existing
`default` notification channel. The phone's own sound picker is reached from
that screen; supported choices, previews and silent mode belong to the OS.
The app reads the channel's effective sound when returning or resuming.

All task and habit notifications pass through `withReminderChannel`, which
also removes per-notification sound overrides. Future reminder types must use
the same scheduling path. Already scheduled notifications use the same channel.

The channel is never deleted or replaced. Existing muted/disabled settings
are respected, and the phone-wide default ringtone is never changed. The
assistant's silent foreground-service notification remains separate.

Android versions before 8 continue using their existing default sound and
show an explicit unsupported-settings message. Web preview cannot access the
phone's ringtone library and shows an explanation instead of simulated choices.
Selecting a sound does not grant notification permission or bypass Do Not Disturb.

Native behavior needs a rebuilt Android package and a device test. Web preview
changes alone cannot add a native plugin to an already installed old APK.
