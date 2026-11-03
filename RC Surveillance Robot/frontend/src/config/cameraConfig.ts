/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CameraConfig } from '../types/camera';
import { IS_PUBLIC_DEMO } from './deploymentMode';

export const CAMERA_STORAGE_KEY = 'rc_surveillance_camera_config_v1';
export const LAST_CONNECTION_KEY = 'rc_surveillance_last_connection_time';

/**
 * Version of the stream-recovery settings (autoReconnect, reconnectIntervalSec, frameMonitor).
 * Configs saved before this existed carry autoReconnect/reconnectIntervalSec only as unused
 * defaults (nothing read them and there was no UI), so they are replaced by the current defaults.
 */
export const RECOVERY_SCHEMA_VERSION = 2;

/**
 * Default camera configuration derived strictly from environment variables.
 * In accordance with project requirements, the live stream path is left unconfigured ("")
 * by default until confirmed on the physical robot firmware.
 */
export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  // The public demo has no robot: it ignores VITE_CAMERA_BASE_URL (Vite would bake a private camera address
  // into a public bundle) and starts with no address, so nothing is probed until a visitor enters their own.
  baseUrl: IS_PUBLIC_DEMO ? '' : (import.meta.env.VITE_CAMERA_BASE_URL as string) || 'http://192.168.1.100',
  streamPath: (import.meta.env.VITE_CAMERA_STREAM_PATH as string) || '',
  snapshotPath: (import.meta.env.VITE_CAMERA_SNAPSHOT_PATH as string) || '/capture',
  // Bounded automatic retries after a stream failure (see StreamConnection). Switchable in Settings.
  autoReconnect: true,
  reconnectIntervalSec: 5,
  frameMonitor: false,
  // Smart Snapshot: off until the user opts in, because a CORS-enabled <img> is refused outright by a
  // camera that does not send Access-Control-Allow-Origin (see CameraConfig.captureCors).
  captureCors: false,
  recoverySchema: RECOVERY_SCHEMA_VERSION,
};

/**
 * Common ESP32-CAM firmware endpoint presets to assist users in quick configuration.
 */
export interface EndpointPreset {
  id: string;
  label: string;
  description: string;
  streamPath: string;
  snapshotPath: string;
}

export const ESP32_PRESETS: EndpointPreset[] = [
  {
    id: 'unconfirmed',
    label: 'Unconfirmed / Base URL Only (Default)',
    description: 'Use when the ESP32 IP is known but the streaming endpoint has not yet been confirmed.',
    streamPath: '',
    snapshotPath: '/capture',
  },
  {
    id: 'arduino-standard',
    label: 'Standard CameraWebServer (Dual Port :80 & :81)',
    description: 'Default official Arduino ESP32 CameraWebServer sketch. Controls on port 80, MJPEG stream on port 81.',
    streamPath: ':81/stream',
    snapshotPath: '/capture',
  },
  {
    id: 'single-port',
    label: 'Single Port Web Server (/stream)',
    description: 'Community firmware variants that stream on the same port as the control UI.',
    streamPath: '/stream',
    snapshotPath: '/capture',
  },
  {
    id: 'mjpeg-direct',
    label: 'Direct MJPEG Route (/mjpeg)',
    description: 'Lightweight Arduino MJPEG streamer firmware sketches.',
    streamPath: '/mjpeg',
    snapshotPath: '/capture',
  },
];

/**
 * Normalizes and resolves a full target URL from baseUrl and an endpoint/port path.
 * Handles dual-port notation (e.g. ":81/stream") as well as standard paths (e.g. "/stream").
 */
export function resolveCameraUrl(baseUrl: string, pathOrPort: string): string {
  const trimmedBase = baseUrl?.trim();
  const trimmedPath = pathOrPort?.trim() || '';

  if (!trimmedBase) return '';

  // If pathOrPort is already a full absolute URL, return it
  if (/^https?:\/\//i.test(trimmedPath)) {
    return trimmedPath;
  }

  try {
    // Ensure baseUrl has a protocol
    const urlWithProtocol = /^https?:\/\//i.test(trimmedBase)
      ? trimmedBase
      : `http://${trimmedBase}`;

    const parsed = new URL(urlWithProtocol);

    if (!trimmedPath) {
      return parsed.origin;
    }

    // Case 1: Dual-port syntax e.g. ":81/stream" or ":81"
    if (trimmedPath.startsWith(':')) {
      const match = trimmedPath.match(/^:(\d+)(.*)$/);
      if (match) {
        const port = match[1];
        const subpath = match[2] || '';
        parsed.port = port;
        parsed.pathname = subpath.startsWith('/') ? subpath : `/${subpath}`;
        return parsed.toString().replace(/\/$/, parsed.pathname === '/' ? '' : '/');
      }
    }

    // Case 2: Standard path e.g. "/stream" or "stream"
    const cleanPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
    // Preserve existing port if present
    parsed.pathname = cleanPath;
    return parsed.toString();
  } catch {
    // Fallback simple string concatenation
    if (trimmedPath.startsWith(':')) {
      return `${trimmedBase}${trimmedPath}`;
    }
    const cleanBase = trimmedBase.replace(/\/+$/, '');
    const cleanPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
    return `${cleanBase}${cleanPath}`;
  }
}

/**
 * Validates a base URL or endpoint input and checks for browser mixed-content risks.
 */
export function validateCameraUrl(url: string): {
  isValid: boolean;
  error?: string;
  isMixedContent: boolean;
} {
  const trimmed = url?.trim();
  if (!trimmed) {
    return {
      isValid: false,
      error: 'URL or IP address cannot be empty.',
      isMixedContent: false,
    };
  }

  // Check if browser is currently on HTTPS
  const isBrowserHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:';

  // Check protocol
  let targetProtocol = 'http:';
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
    const withProto = hasScheme ? trimmed : `http://${trimmed}`;
    const parsed = new URL(withProto);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        isValid: false,
        error: 'Only HTTP and HTTPS protocols are supported.',
        isMixedContent: false,
      };
    }

    targetProtocol = parsed.protocol;

    if (!parsed.hostname) {
      return {
        isValid: false,
        error: 'Invalid hostname or IP address format.',
        isMixedContent: false,
      };
    }
  } catch {
    return {
      isValid: false,
      error: 'Please enter a valid URL (e.g. http://192.168.1.100).',
      isMixedContent: false,
    };
  }

  const isMixedContent = isBrowserHttps && targetProtocol === 'http:';

  return {
    isValid: true,
    isMixedContent,
  };
}
