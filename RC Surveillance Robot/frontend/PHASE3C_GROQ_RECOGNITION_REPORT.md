# Phase 3C Report: Groq AI Object Recognition

Scope: send one camera frame at a time to Groq, through a small backend that holds the API key, and show what the model says it sees. No video recording, no continuous streaming to the AI, no motor, Bluetooth or driving code, no other AI provider, no change to the configured camera address.

## Read this first

1. **No real Groq inference was run.** I have no Groq key, and the task forbids contacting Groq or the camera in tests. Every "recognition" below is either a mocked test or a **canned answer from `tools/mock-groq`**, which validates the request shape and never looks at the picture. **Real recognition quality is unverified.**
2. **The physical camera was not contacted at all.** Camera frames in the browser runs came from the mock camera.
3. The only vision model Groq documents today is a **Preview** model that "may be discontinued at short notice". The feature depends on it (section 2).

## 1. What was built

| Piece | Where |
| --- | --- |
| AI backend (Node, TypeScript, no packages): `POST /api/ai/recognize`, `GET /api/ai/status` | `server/` |
| Browser client, settings, history, supervisor | `services/aiClient.ts`, `aiSettings.ts`, `aiHistory.ts`, `aiRecognizer.ts` |
| Motion alerts to the AI card | `services/motionEventBus.ts` (and an optional `onMotionEvent` in `motionMonitor.ts`) |
| Keep the analysed frame in the gallery | `snapshotActions.ts` `saveFrame` (Smart Snapshot storage reused) |
| UI | `components/AiRecognitionPanel.tsx`, `hooks/useAiRecognition.ts` |
| Mock Groq for end-to-end testing | `tools/mock-groq/mock-groq.mjs` |
| Tests | `serverCore`, `serverGroq`, `serverApp`, `keySecrecy`, `aiRecognizer`, `aiSupport` (+ `serverFakes`, `aiFakes`) |

Modified existing files: `Dashboard.tsx`, `MotionDetectionPanel.tsx` (shared snapshot text, listener prop), `motionMonitor.ts`, `useMotionDetection.ts`, `snapshotActions.ts`, `useSmartSnapshot.ts`, `vite.config.ts` (the `/api` proxy), `package.json` (scripts only, no dependencies), `tsconfig.json`, `tsconfig.test.json`, `.env.example`, existing tests `motionMonitor.test.ts` and `snapshotActions.test.ts` (tests added, none removed), `README.md`. New config: `tsconfig.server.json`.

**New dependencies: none.** The backend uses Node's built-in `http` and `fetch`, and TypeScript is already installed.

## 2. Model decision and the evidence

Checked on 2026-10-21 against Groq's own documentation (console.groq.com/docs: vision, models, model page, rate-limits, deprecations, structured-outputs, reasoning, your-data). I read the pages with a web-fetch tool that summarises them, so I cross-checked each key fact on at least two pages. I made **no API call**, so nothing below was confirmed by the live service.

- **Chosen: `qwen/qwen3.8-27b`**, status **Preview**. Input text and images, output text; 131,072-token context; 16,384 max output tokens; up to 3 images; 20 MB request limit; each image counts as 2,048 input tokens; supports JSON Schema strict structured output and `reasoning_effort: none`. Price $0.80 / $4.00 per million input / output tokens.
- **Ruled out:** Llama 4 Scout (shutdown 07/17/26) and Maverick (03/09/26) are deprecated; the older Llama 3.2 vision previews and LLaVA are long gone; `meta-models/muse-spark-open` is a limited preview that requires contacting Groq.
- **Limits listed for the model** (plan not stated): 30 requests/min, 1,000/day, **8,000 tokens/min, 200,000 tokens/day**.
- **Data handling:** by default Groq does not retain inference data, but may temporarily log inputs and outputs up to 30 days for reliability or abuse investigation; Zero Data Retention is opt-in; the page does not specifically address images; data is stored in US Google Cloud buckets.
- **Not verified:** that the model recognises people, animals and vehicles *reliably* in small camera frames (no accuracy claim exists in the docs, and I could not test), the actual token count and latency of a real request, the exact limits of your account, and whether the preview model is still available when you read this.

It is a language model: **no bounding boxes, no class IDs, no confidence scores** are produced, so none are shown. The model sets a "not sure" flag itself; unsure or unknown results never count as events.

## 3. Security design

- The key is read from `GROQ_API_KEY` on the server only. It is not in any `VITE_` variable, not in the web bundle (the built `dist/` was scanned: no key, no variable name, no `Authorization`, no `api.groq.com`), not returned by any endpoint, not logged (`redactSecrets` also scrubs provider messages), not stored in the browser. `tests/keySecrecy.test.ts` guards the source files.
- Backend: listens on 127.0.0.1; accepts JPEG only, size-capped before decoding; checks the page origin (local pages, or `AI_ALLOWED_ORIGINS`); caps what it forwards to Groq (6 per minute, 100 per day by default, all clients together) and runs one request at a time; times out after 20 s; retries only a short rate limit, a 5xx or a network error, once; never retries a timeout; abandons the Groq call if the browser disconnects; never returns a stack trace.
- **Residual risk:** there is no login (the project has none and none was added). `npm run dev` listens on all interfaces, so someone on your network could use the proxy from a non-browser client until the caps are reached. Documented in the README.

## 4. Controlling usage

Master switch off by default; automatic mode needs a ticked acknowledgement and is off by default; one request at a time (extra triggers are dropped, not queued); automatic cooldown (default 60 s) that also starts when a request fails, so a failure cannot cause a retry storm; one analysis per motion alert; a Groq rate-limit or quota answer blocks further requests for the time Groq names; a late answer after leaving the page or switching off is ignored; picture size is checked before sending; frame access blocked by the browser pauses automatic analysis until the stream reconnects.

## 5. Verification (mocked tests vs mock-browser vs real)

### Automated, mocked: 674 tests pass, 0 fail
`npm test` 674 passed (489 existing + 185 new). `npm run lint` passed (app, server, and strict test type-check). `npm run build` passed. No test contacts Groq or a camera.

New tests cover: missing key, key secrecy (responses, logs, request body, source files), valid and invalid images, size limits, request construction, provider success, timeout, errors, rate limits and quota, malformed and unknown model output, normalisation, origin and method checks, local limits and concurrency, a browser that disconnects, manual and motion-triggered recognition, cooldown, duplicate and concurrent request prevention, stale responses, filters, snapshot integration, history persistence and corruption, storage failures, frame-access failures and camera disconnects.

### Mutation checks (scratch copy only; the project was never modified)
19 deliberate bugs were injected one at a time into a throwaway copy, and the suite was run against each: cooldown, one-request-at-a-time, duplicate alert, stale answers, blocked-picture retry, duplicate snapshots, rate-limit block, size limits, the privacy acknowledgement, "unsure counts as a match", the key in the Groq request body, an `Authorization` header in the browser, the origin check, the server rate limiter, image size and category handling, history bounds, the retry cap and retrying timeouts. **All are caught by failing tests.** The first pass found one real gap (an answer that arrives *after* cancel was not tested, because my fake client always honoured the abort); I added tests for it and re-ran those mutants, together with two whose first catch was only a build error, using compile-safe patches: all caught.

### Mock-browser (real Chromium, mock camera, mock Groq, real backend and Vite proxy): **simulated**

| Check | Result |
| --- | --- |
| Default state | OFF; nothing sent (mock Groq saw 0 requests); Analyze and automatic mode disabled; disclosure visible |
| Enable and Analyze (4 s mock delay) | READY → ANALYZING (button disabled, loading text) → result card with category, "matches your filters", time, model, tokens, disclaimer; mock saw 1 request with a 1,545-byte JPEG, no key in the body |
| Malformed / bad JSON output | "The model's answer could not be understood…", recorded as failed |
| Provider 500 | 2 requests at Groq (one retry), then failed; **bad key: 1 request, no retry** |
| 5 clicks in a row | exactly 5 history rows |
| 429 with a 20 s wait | countdown 20, 19, 18…, button disabled, nothing sent while blocked, recovered after |
| Automatic mode | acknowledgement unlocks it; 4 motion alerts gave 3 Groq requests (the one inside the 30 s cooldown was skipped); each linked to its alert; one snapshot per analysis in the gallery, no banners |
| Filters | unticking Animals while running: the next dog result was shown but was not an event and kept no snapshot |
| Master switch off | 2 motion alerts in 36 s, **0** requests to Groq |
| Backend stopped | BACKEND PROBLEM, the exact start command, "Check again"; failure recorded; recovery after restart |
| Leave the page mid-request | request abandoned within about 1 s (backend log), answer ignored, nothing recorded |
| Reload | settings and history restored; history holds text only, never an image |
| Clear history | first click asks; Cancel withdraws it; confirm empties list and storage |
| Mobile 375×812 (emulation) | no horizontal scroll, no overflow; 11 controls named and tabbable |
| `npm run preview` proxy | `/api/ai/status` answered through it |

### Not verified
Real Groq inference and real recognition accuracy; the real camera; the real model's token counts, latency and errors; Firefox/Safari.

## 6. Notes on my own testing

- A first measurement script of mine raced its own scenario switches, which produced one confusing result; the clean rerun (5 clicks, 5 rows, expected request counts) shows no dropped clicks.
- My first "leave the page mid-request" test left before the request was sent; I noticed from the backend log and repeated it correctly.
- Testing found two small bugs that are fixed: a request with no `mimeType` returned 415 instead of 400, and a stale "backend not reachable" banner stayed after the backend came back.

## 7. Remaining limitations

- Everything under "Not verified". The Preview model can change or vanish; there is no other Groq vision model to fall back to.
- Groq's limits for the model are small (about 2 to 3 analyses a minute, roughly 70 a day by my estimate): this is a spot-check tool, not continuous recognition.
- Frames are small (the camera is 640×480 at best), so small or distant objects may be missed or mislabelled.
- Only the Live Stream view can be analysed (it needs the live picture and the page's CORS permission).
- The privacy statement relies on Groq's documentation, which does not address images specifically.

## 8. Test it on your camera and key

Steps are in README section 16 (item "Verify with your real camera and key"). Start by checking that READY and the model name appear, then analyse a frame with a person in it and compare the answer with what you see before trusting automatic mode.
