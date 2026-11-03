Raw evidence behind PHASE2_DIAGNOSTICS_REPORT.md. Everything here was produced in a Linux sandbox against a MOCK camera
(tools/mock-esp32-cam), with Playwright's headless Chromium 141 and Node 22. None of it involves a real ESP32-CAM,
real Wi-Fi or a real power supply.

unit-tests-spec-output.txt                       Full listing of the 291 mocked unit tests (118 from Phase 1 + 173 new) and their results.
mutation-checks.txt                              20 deliberate bugs and whether the tests caught them.
browser-phase2-scenarios-P1-P14.json             The REAL Phase 2 dashboard code driven in Chromium against the mock camera.
                                                 Scenarios P1..P14 (P5b is an extra). Contains page text read from the UI.
browser-phase1-scenarios-rerun-on-phase2.json    The 11 Phase 1 scenarios (N1..N11, see docs/phase1-evidence) re-run unchanged on the Phase 2 code.
vite-build-attempt.txt                           The actual output of the production build attempt (it could not run in the sandbox).
screenshots/                                     Diagnostics tab at 1280 px and 390 px wide, and the Copy Report feedback states.

The dashboard code was bundled with bun and Tailwind was compiled with its JavaScript-only compiler, because Vite's native
bundler does not run in that sandbox. So these runs exercise the real application logic and the real component code with
the real class names, but they are not the output of `vite build`. The browser-driving scripts used a sandbox-only
Playwright install and are not shipped.
