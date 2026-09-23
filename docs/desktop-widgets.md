# Desktop Widgets

## Implemented

- Toolbox configuration for task and course widgets, scoped by account.
- Three linked layouts: 7-day view, agenda list, and month calendar with agenda. Layout previews use existing task/course records; there is no widget-specific event entry.
- Repeating tasks are expanded across the available range, and course rows include date, period, class, and room when available.
- Privacy defaults: disabled widgets, hidden titles. Only sanitized display text and timestamps are shared; no credentials or full records.
- Snapshot refreshed while the authenticated app is active, after planner changes, or from the configuration refresh action.
- Android: AppWidgetProvider, launcher pin request when supported, click to open tasks/courses.
- iOS: WidgetKit extension target, App Group storage, timeline expiry/course transitions, URL routing.
- Course reminders use the effective teacher after substitutions; a configured teaching name is required.
- Notification scheduling stays separate. Widgets do not create duplicate notifications.
- Snapshots expire after one day, or midnight for today's tasks. Closed apps do not fetch new server data.

## Verification and Release Limits

Windows can build Android and test web/data behavior. It cannot compile or sign iOS.
The iOS widget target requires iOS 17+ and Xcode 15+.
On macOS, enable `group.cn.zaizai.companion` for both App and ZaizaiWidgets using the same Apple developer team, run `pnpm exec cap sync ios`, then build App in `ios/App/App.xcworkspace`.
Set `VITE_NATIVE_API_URL` to a reachable HTTPS backend before building/syncing; no server secrets belong in the app.
Required device checks: pin/add on both systems, account logout/switch, cold/warm widget taps, midnight expiry, substitution/cancellation refresh, privacy masking, background notification permissions.

## Existing Platform Work Still Outstanding

Adding the iOS project does not certify the rest of the app for iOS.
The existing Android-specific floating assistant, biometric/app-lock bridge, document export, notification settings bridge and system calculator still require separate iOS implementation or an explicit platform-appropriate alternative.
Do not describe the iOS app or all-platform feature parity as verified until those paths and signing are tested on Apple hardware.
