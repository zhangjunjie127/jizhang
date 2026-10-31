# Long-term companions

## Contract

- Stable IDs: gentle, blunt, witty, rational, bright, calm. Existing users retain their selection.
- Public metadata lives in shared/personas.mjs. Server-only behavioral profiles live in server/domain.mjs.
- Text, realtime voice and proactive check-ins use systemPrompt. A personality does not grant new tool permissions or notification frequency.
- Core temperament does not evolve automatically. Adaptation uses existing user-approved memories, current requests and recent real context.
- Preference changes require the existing confirmation workflow. Current conversational boundaries apply immediately.
- No fabricated shared history, relationship scores, guilt for absence, or automatic sensitive profiling.
- Switching retains account records and approved memories. Active voice sessions retain the existing switch guard.
- Three existing voice timbres are reused with six delivery instructions; this is not six independently verified voices.

## Verification (2026-10-10)

- node --test tests/*.test.mjs: 186 passing.
- Vite production build passes; pre-existing large-chunk warning remains.
- scripts/smoke-personas.mjs: isolated account, six choices at 320/390/1280px, persisted changes, visible failure feedback, no page errors.
- scripts/probe-persona-text.mjs: two synthetic turns per personality against the configured text gateway; no real account data sent and no returned tools executed.
- First live sample exposed repeated week-long experiments and arbitrary numerical thresholds. Prompt revision removed compulsory action scripts and added per-personality decision paths.
- Second live sample: all 12 responses returned; all six respected the request to stop analysis and keep the response short. Tone and emphasis differ, but some suggestions still overlap.
- Samples and screenshots are generated under artifacts/personas. API success and prompt unit tests are not proof of long-term personality consistency.

## Remaining Validation

Longitudinal user testing is needed for perceived familiarity and personality stability. This change does not train model weights or retain unlimited conversation history. Realtime voice instructions use the shared profile, but six-personality audio quality and Android-device presentation have not been re-audited in this change. No APK or Git push is included.
