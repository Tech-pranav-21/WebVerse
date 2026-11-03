/**
 * Client for interacting with the local Python Pose Estimation service.
 *
 * Every request has a time limit and fails with a PoseClientError whose message can be shown to the
 * user as is. The browser first tries the Vite proxy (/api/pose/...) and falls back to the service's
 * own port; one deadline covers both attempts.
 */

import { blobToBase64 } from './aiClient';
import type { PoseDetectionResult, PoseServiceHealth } from '../types/pose';
import { PoseClientError } from './poseErrors';
import { parsePoseDetectionResult } from './poseResponse';

const POSE_SERVICE_BASE = '/api/pose';
const DIRECT_SERVICE_BASE = 'http://127.0.0.1:8000';
/** The first inference after the service starts can take a few seconds on the CPU. */
const DEFAULT_DETECT_TIMEOUT_MS = 20_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 4_000;

export interface PoseRequestOptions {
  confThreshold?: number;
  keypointThreshold?: number;
  signal?: AbortSignal;
  /**
   * Frames that share a session id are one video: the service tracks people and judges movement across
   * them. Use a different id for anything that is not that video.
   */
  sessionId?: string;
  /** false analyses this frame alone (no tracking, no history). Default true. */
  trackActivity?: boolean;
  /** true forgets the session's tracks and history first. */
  resetTracking?: boolean;
  /** true also returns the skeleton overlay in the same response (one inference instead of two). */
  includeAnnotated?: boolean;
}

export interface PoseClientOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  proxyBase?: string;
  directBase?: string;
  detectTimeoutMs?: number;
  healthTimeoutMs?: number;
}

export interface PoseClient {
  checkHealth(signal?: AbortSignal): Promise<PoseServiceHealth | null>;
  detect(imageBlob: Blob, options?: PoseRequestOptions): Promise<PoseDetectionResult>;
  detectAnnotated(
    imageBlob: Blob,
    options?: PoseRequestOptions,
  ): Promise<{ blob: Blob; personCount: number; latencyMs: number; device: string }>;
}

/** What the service said about a failed request: FastAPI's `detail` is a string or a list of {msg}. */
async function readDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const msgs = detail.map((d) => (typeof d?.msg === 'string' ? d.msg : null)).filter(Boolean);
      if (msgs.length) return msgs.join('; ');
    }
  } catch {
    // not JSON
  }
  return null;
}

async function failureFor(res: Response): Promise<PoseClientError> {
  const detail = await readDetail(res);
  if (res.status === 503) {
    return new PoseClientError(
      'model_unavailable',
      `The pose model is not loaded on the local service${detail ? ` (${detail})` : ''}. Check the service's startup log.`,
      503,
    );
  }
  if (res.status >= 400 && res.status < 500) {
    return new PoseClientError('bad_request', detail ?? `The pose service rejected the frame (HTTP ${res.status}).`, res.status);
  }
  return new PoseClientError('server_error', detail ?? `The pose service failed to process the frame (HTTP ${res.status}).`, res.status);
}

export function createPoseClient(options: PoseClientOptions = {}): PoseClient {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const proxyBase = options.proxyBase ?? POSE_SERVICE_BASE;
  const directBase = options.directBase ?? DIRECT_SERVICE_BASE;
  const detectTimeoutMs = options.detectTimeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS;
  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

  /** Proxy first, then the direct port; one deadline for both. */
  async function request(endpoint: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
    if (outer?.aborted) throw new PoseClientError('cancelled', 'The request was cancelled.');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener('abort', onOuterAbort);
    const withSignal: RequestInit = { ...init, cache: 'no-store', signal: controller.signal };

    try {
      try {
        const res = await fetchImpl(`${proxyBase}${endpoint}`, withSignal);
        // 400/413 are real answers of the service. So is any JSON reply (it carries the service's `detail`).
        // A proxy that cannot reach the service answers with plain text, which is when the direct port is tried.
        const fromService = (res.headers.get('content-type') ?? '').includes('application/json');
        if (res.ok || res.status === 400 || res.status === 413 || fromService) return res;
      } catch (err) {
        if (controller.signal.aborted) throw err;
        // proxy not reachable: try the direct port
      }
      return await fetchImpl(`${directBase}${endpoint}`, withSignal);
    } catch (err) {
      if (timedOut) {
        throw new PoseClientError(
          'timeout',
          `The pose service did not answer within ${Math.round(timeoutMs / 1000)} seconds. It may be busy or still loading the model.`,
        );
      }
      if (outer?.aborted) throw new PoseClientError('cancelled', 'The request was cancelled.');
      if (err instanceof PoseClientError) throw err;
      throw new PoseClientError(
        'unreachable',
        'Cannot reach the local pose service. Start it with: python activity-recognition/run_service.py',
      );
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }
  }

  async function body(imageBlob: Blob, o: PoseRequestOptions): Promise<string> {
    return JSON.stringify({
      imageBase64: await blobToBase64(imageBlob),
      mimeType: imageBlob.type || 'image/jpeg',
      confThreshold: o.confThreshold,
      keypointThreshold: o.keypointThreshold,
      sessionId: o.sessionId,
      trackActivity: o.trackActivity,
      resetTracking: o.resetTracking,
      includeAnnotated: o.includeAnnotated,
    });
  }

  return {
    async checkHealth(signal) {
      try {
        const res = await request('/health', { method: 'GET' }, healthTimeoutMs, signal);
        if (!res.ok) return null;
        return (await res.json()) as PoseServiceHealth;
      } catch {
        return null;
      }
    },

    async detect(imageBlob, o = {}) {
      const res = await request(
        '/detect',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await body(imageBlob, o) },
        detectTimeoutMs,
        o.signal,
      );
      if (!res.ok) throw await failureFor(res);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new PoseClientError('invalid_response', 'The pose service returned a response that is not valid JSON.');
      }
      return parsePoseDetectionResult(json);
    },

    async detectAnnotated(imageBlob, o = {}) {
      const res = await request(
        '/detect/visualize',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await body(imageBlob, o) },
        detectTimeoutMs,
        o.signal,
      );
      if (!res.ok) throw await failureFor(res);
      const blob = await res.blob();
      return {
        blob,
        personCount: Number(res.headers.get('X-Person-Count') || '0'),
        latencyMs: Number(res.headers.get('X-Inference-Time-Ms') || '0'),
        device: res.headers.get('X-Device') || 'unknown',
      };
    },
  };
}

export const poseClient: PoseClient = createPoseClient();
