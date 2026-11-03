/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Notice } from './ui';

export const LOCAL_SETUP_GUIDE_URL = 'https://github.com/Tech-pranav-21/WebVerse/tree/main/RC%20Surveillance%20Robot';

/**
 * Shown on the public demo build only (the Dashboard decides; see config/deploymentMode.ts). It says plainly
 * that nothing on this page is a live robot, and where live operation is possible instead.
 */
export const DeploymentModeBanner: React.FC = () => (
  <div className="px-3 sm:px-5 pt-3">
    <Notice tone="info" role="status">
      <p>
        <strong className="font-semibold text-white">Public demo: no robot is connected.</strong> This hosted copy has no
        camera, AI service or pose service, and a website cannot reach a camera on your private network. Live video, AI
        recognition and pose estimation work only in Local Hardware Mode: run the dashboard on your own computer, on the
        same network as the ESP32-CAM.
      </p>
      <p>
        <a
          href={LOCAL_SETUP_GUIDE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
        >
          How to run it locally
        </a>
      </p>
    </Notice>
  </div>
);
