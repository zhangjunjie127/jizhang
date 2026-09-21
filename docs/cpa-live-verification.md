# CPA Live verification

Checked on 2026-09-16.

## Source evidence

Repository revision: `8335eac731946bd4eff18f500653f93736df53d6`.

- The Live handler sets `defaultLiveModel = "gpt-live-1-codex"` and forwards
  WebRTC session setup to the ChatGPT Codex realtime calls endpoint:
  https://github.com/router-for-me/CLIProxyAPI/blob/8335eac731946bd4eff18f500653f93736df53d6/internal/client/codex/live/live.go
- Routes include POST `/v1/live`, GET `/v1/realtime`, POST
  `/v1/realtime/calls`, and POST `/v1/realtime/client_secrets`:
  https://github.com/router-for-me/CLIProxyAPI/blob/8335eac731946bd4eff18f500653f93736df53d6/internal/api/server_routes.go#L81-L100
- `codexRealtimeModel` maps the standard realtime family and realtime-preview
  names to the default Live model. Other names are retained, so do not assume
  `gpt-live-1` and `gpt-live-1-codex` are interchangeable:
  https://github.com/router-for-me/CLIProxyAPI/blob/8335eac731946bd4eff18f500653f93736df53d6/internal/client/codex/live/client_secret.go#L368-L375
- The direct WebSocket handler uses the mapped model for credential selection,
  but passes the requested model to the upstream WebSocket URL. WebRTC and
  direct WebSocket model handling must not be conflated:
  https://github.com/router-for-me/CLIProxyAPI/blob/8335eac731946bd4eff18f500653f93736df53d6/internal/client/codex/live/websocket.go
- A repository example demonstrates PCM audio input, audio output, and
  assistant transcripts using the realtime routes:
  https://github.com/router-for-me/CLIProxyAPI/blob/8335eac731946bd4eff18f500653f93736df53d6/examples/realtime-openai-go/README.md

## Deployed endpoint probes

Authenticated checks used the endpoint supplied by the user. Credentials are
not recorded here. No microphone data, generation request, or valid session
creation request was sent in these probes.

| Request | Observed result | Meaning |
| --- | --- | --- |
| GET `/v1/models` | 12 models; no Live model listed | Model enumeration alone does not establish realtime availability. |
| GET `/v1/realtime` without WebSocket upgrade | HTTP 426, `websocket_upgrade_required` | Realtime route is present. |
| POST `/v1/realtime/client_secrets` with deliberately invalid session type `capability-probe` | HTTP 501, `realtime_capability_not_supported`, rejecting that session type | Client-secret handler is present; this is not a valid-session failure. |
| POST `/v1/live` with empty multipart body | HTTP 400, `Codex live multipart body requires an sdp field` | Live setup handler is present. |

Earlier HTTPS connection attempts failed at the TLS handshake. HTTP responded.
The cause of the TLS failure has not been established; do not describe it as a
confirmed certificate problem.

## Conclusion and remaining checks

The repository implements Codex Live, and the user's deployment exposes
corresponding routes. An absent Live entry in `/v1/models` does not disprove
this capability.

## Subsequent real-session verification

The direct WebSocket route rejected `gpt-live-1-codex` with `invalid_model`.
The same route accepted `gpt-realtime-2.1` and sent `session.created`.
Its input turn-detection settings included `interrupt_response: true`.

A bounded output test received 192000 PCM audio bytes, a Chinese transcript,
and `response.done` with status `cancelled` after sending `response.cancel`.
First audio arrived approximately 2002ms after starting that single test.
This is not a service-level latency guarantee.

The implemented app relay was then tested with synthetic spoken input. It
returned an input transcript, a meaningful Chinese response, and 732000 output
PCM bytes. Browser testing with a fake microphone subsequently exercised
AudioWorklet capture, playback, transcript rendering, response cancellation,
and conversation-item truncation. No page errors were observed.

Remaining checks: Android physical-device microphone, echo cancellation,
notification delivery, sustained latency, concurrency, production transport
security, account entitlement durability, and deployment suitability.
