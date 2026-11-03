/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where this copy of the dashboard runs.
 *
 *   local  The default: `npm run dev`, `npm run build`, `npm run preview`. The dashboard, the AI backend
 *          and the pose service run on the user's computer, next to the ESP32-CAM on the same network.
 *   demo   The public build (`npm run build:demo`, i.e. `vite build --mode demo`) hosted on the web.
 *          No robot, camera, AI backend or pose service exists there, and a website cannot reach a camera
 *          on a private network. The dashboard says so instead of pretending.
 *
 * This file only decides the mode from the build mode; config/deploymentMode.ts reads the build mode.
 */

export type DeploymentMode = 'local' | 'demo';

export function resolveDeploymentMode(buildMode: string | undefined): DeploymentMode {
  return buildMode === 'demo' ? 'demo' : 'local';
}
