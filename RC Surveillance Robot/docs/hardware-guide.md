# ESP32-CAM hardware and network guide

## What this project expects

The dashboard expects an ESP32-CAM-compatible HTTP server that provides an MJPEG stream and, optionally, a JPEG snapshot endpoint. Camera firmware, motor hardware, and motor-control firmware are not part of this repository.

## Prototype hardware reference

Photographs of the physical benchtop prototype are cataloged in `docs/images/`:
- `docs/images/Hardware.jpeg`: Overhead view showing chassis, Arduino Uno, forward ESP32-CAM, L298N driver, buck regulator, battery pack with BMS, and LCD screen.
- `docs/images/Hardware%202.jpeg`: Front angle perspective showing the vertically oriented ESP32-CAM optical mount.
- `docs/images/Hardware%20Component.jpeg`: Visual breakdown of subsystem components.

## Recommended setup

- ESP32-CAM AI-Thinker-style board with OV2640 camera
- A stable 5 V supply capable of handling camera and Wi-Fi startup current
- A USB-to-serial adapter for flashing, with a shared ground
- A 2.4 GHz Wi-Fi network; ESP32-CAM boards do not join 5 GHz-only networks

Follow the pin labels printed on the specific board and the instructions for its flashing adapter. For the common ESP32-CAM bootloader workflow, GPIO 0 is held to GND while flashing and released before normal boot. Verify the voltage requirement of the board and adapter before wiring power.

## Configure the dashboard

1. Flash and boot a compatible camera sketch.
2. Use its serial output or router client list to find the assigned local IP address.
3. Open the camera URL directly in a browser to confirm the real stream and snapshot routes.
4. In dashboard Settings, set the camera base URL and confirmed paths.
5. Start with the ordinary stream. Enable CORS-dependent capture only after validating that the camera returns `Access-Control-Allow-Origin` for the selected endpoint.

Common routes include `:81/stream` with `/capture`, but route and port choices are firmware-specific and are not guaranteed by this project.

## Network requirements

Run the dashboard on a machine that can reach the camera's local IP. A public HTTPS deployment cannot generally load an unsecured `http://` camera stream because of browser mixed-content protections. Local hardware mode should therefore use `http://localhost:3000`.

## Troubleshooting

- **Repeated resets or unstable video:** suspect inadequate power before changing application settings.
- **No stream:** confirm the camera IP, port, and route from the firmware documentation or serial monitor.
- **View works but processing fails:** CORS is likely absent; the browser can display an image stream yet cannot access its pixels.
- **Cannot join Wi-Fi:** ensure the target SSID provides 2.4 GHz access.

Hardware integration has not been verified for this repository. Treat this guide as a compatibility checklist, not a tested flashing procedure.
