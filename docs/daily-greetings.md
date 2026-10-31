# Daily greeting bubbles

## Behavior

- Six existing personality profiles generate short greetings through the configured AI backend; there is no canned-text fallback.
- Each account has a stable, date-varying first eligible time between 09:00 and 11:30, Asia/Shanghai. Missed slots can run later before 20:30.
- At most one greeting per account/day, across devices and service restarts. Greetings share the proactive daily quota, quiet toggle, 24-hour pause, three-hour spacing and recent-conversation suppression.
- An unanswered greeting does not prevent another day's greeting. It does prevent further same-day unsolicited nudging.
- The last 30 actual greeting texts are supplied to generation. Normalized text and character-bigram similarity reject obvious repetition; one immediate regeneration is permitted. This is not a guarantee of semantic uniqueness.
- No sensitive record details are intended for the publicly visible bubble. Existing persona instructions, explicit conversational boundaries and approved preferences still apply.

## Delivery

- Authenticated POST /api/assistant/greeting generates on demand only. It ignores caller-supplied user IDs, uses the session owner and rechecks state after model completion.
- The existing checkins table stores the daily topic and message. The response contains only a newly committed greeting, never a replay queue.
- Delivery is at-most-once: network loss after commit or a screen lock before display may suppress that day's bubble. The chat message remains available. This is intentional to avoid stale greetings after reconnect.
- Android's existing foreground overlay service polls every five minutes while eligible, separately from the hidden React WebView. It checks screen/lock, overlay visibility, file picker, call and panel state, as well as recent cat interaction.
- The bubble sits beside the cat, dismisses after 15 seconds, supports manual dismissal and opens the conversation on tap. Screen-off, dragging, opening the panel and service teardown dismiss it. No new notification, sound or vibration is sent.
- Browser preview uses the same endpoint but only while the page is visible and the assistant is collapsed.
- The overlay service, overlay permission, network and backend must remain available. A force-stopped service cannot greet. This feature does not add a service restart or push-notification workaround.

## Checks

- tests/proactive.test.mjs: date boundaries, quotas, idempotence, concurrency, failed/duplicate generation, preferences/state changes during generation.
- tests/app.test.mjs: authenticated routing, account scope, no-AI silent result.
- scripts/check-greeting-layout.ps1: native placement on both edges and narrow screens.
- scripts/smoke-greeting-ui.mjs: browser widths 320/390/1280, auto-hide, dismiss and opening chat.
- scripts/probe-greetings.mjs: bounded synthetic real-model samples for all six personalities, successive greetings and opt-out.
- Android Java compilation is checked without packaging. No Android device was connected for background/lockscreen end-to-end testing.
