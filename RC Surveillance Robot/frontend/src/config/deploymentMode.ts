/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DeploymentMode, resolveDeploymentMode } from '../services/deploymentMode';

/** Fixed when the app is built: `vite build --mode demo` makes it 'demo', everything else 'local'. */
export const DEPLOYMENT_MODE: DeploymentMode = resolveDeploymentMode(import.meta.env.MODE);

/** True on the public web demo, where no robot, camera or backend exists. */
export const IS_PUBLIC_DEMO: boolean = DEPLOYMENT_MODE === 'demo';
