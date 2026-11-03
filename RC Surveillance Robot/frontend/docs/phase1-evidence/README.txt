Raw evidence behind PHASE1_STABILITY_REPORT.md. All of it was produced in a Linux sandbox against a MOCK camera
(tools/mock-esp32-cam), with Playwright's headless Chromium 141 and Node 22. None of it involves real ESP32-CAM
hardware, real Wi-Fi or a real power supply.

dashboard-before-original-code.json   The ORIGINAL dashboard code driven in Chromium (scenarios S1..S8).
dashboard-after-modified-code.json    The MODIFIED dashboard code, same method (scenarios N1..N11).
browser-experiments/                  Small experiments on what a plain <img> / fetch() can observe (E1..E10).
unit-tests-spec-output.txt            Full listing of the 118 mocked unit tests and their results.

The dashboard code was bundled with bun (Vite's native bundler cannot run in that sandbox), so Tailwind styling was not
applied in those runs. They exercise the real application logic, not the final visual design.
The browser-driving scripts used a sandbox-only Playwright install and are not shipped.
