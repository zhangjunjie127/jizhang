# Planner calendar

- Month view uses Sunday-first, four to six full weeks, fitting the available screen without calendar scrolling.
- Planner opens on Calendar. Its three top tabs are Calendar, Habits and Courses. The icon-only List entry sits immediately after Today, switches within the same panel, and has a return-to-calendar action; list filters and calendar selection survive switching.
- Each date shows exactly the first six entries when six or more exist, sorted by Shanghai time (24-hour HH:mm); untimed tasks and anniversaries follow. Shorter cells compact their date header, row height and footer instead of reducing the entry count. Entry text never exceeds the festival text size. Bottom-left counts show the combined total, including hidden entries; empty dates show no count.
- Calendar view always includes all categories and has no category-filter button. The list keeps its own filter; its selection does not constrain calendar contents or new calendar tasks.
- Task category selection uses the existing six categories and colors with Lucide line icons. The native dialog preserves form contents, supports Escape/cancel, and writes the selected value to the existing form field. AI classification and manual-choice precedence are unchanged.
- The compact month trigger opens a year/month dialog with draft selection. Confirm applies the month; Return, Escape and closing discard the draft without changing the selected month or day.
- Preview corners are triangular wedges anchored to the bottom-right, without an arrow. The highest priority among all displayed-day task records (including entries beyond the visible limit) sets the color using the same red, orange, green, or blue as the priority form. Anniversary-only days use muted gold; empty days use pale gray. The corner tooltip and accessible description name its status.
- The corner opens a floating day preview with a fixed close header/add footer and independently scrollable content. It shows all tasks/anniversaries, lunar date, festivals, constellation, sexagenary year/month/day/time, zodiac animal, week/weekday and traditional almanac Yi/Ji.
- The reference time automatically uses the current Shanghai time when the preview opens; there is no time picker. Almanac content uses the library's original traditional labels, not modern scientific advice.
- The existing bottom add button opens task/anniversary choices in calendar view.
- `lunar-javascript` 1.7.7 (MIT) provides lunar conversion, solar terms, festivals and its bundled published holiday overrides. Unknown years never infer rest/work overrides. Upgrade/test the dependency when a new official holiday schedule is published.
- The grid prioritizes standard festivals and solar terms; day details include the complete set of public commemorations provided by the library.
- An anniversary stores its original Gregorian date, recurrence calendar (`solar`/`lunar`) and recurrence (`yearly`/`once`). The editor also displays the corresponding lunar date.
- Recurrence never precedes the original date. February 29 occurs only in leap years; a leap lunar month occurs only when that same leap month exists. No implicit date substitution.
- `planner_anniversaries` is separate from the original constrained habit/course table, avoiding a destructive migration. Existing `/api/planner` endpoints preserve user isolation, idempotency, revisions and account-deletion cascades.
- No external upload or network calendar subscription is used for dates or anniversaries.

Verification: `node --test tests/*.test.mjs`, Vite build, and `scripts/smoke-planner.mjs` with a temporary account/database.
