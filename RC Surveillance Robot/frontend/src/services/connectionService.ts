/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConnectionProbeResult } from '../types/camera';

/**
 * Checks whether the current page is running under HTTPS
 * which triggers browser mixed-content blocking when requesting HTTP IP cameras.
 */
export function isMixedContentRestricted(targetUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  const isPageHttps = window.location.protocol === 'https:';
  const isTargetHttp = /^http:\/\//i.test(targetUrl.trim());
  return isPageHttps && isTargetHttp;
}

/**
 * Monotonic milliseconds for measuring durations. Date.now() can jump (clock adjustments, NTP),
 * which would produce negative or huge "response times"; performance.now() cannot.
 */
export function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/**
 * Returns "scheme://host:port" for a URL (or bare IP/host), or '' if it cannot be parsed.
 */
export function hostOrigin(url: string): string {
  const trimmed = url?.trim();
  if (!trimmed) return '';
  try {
    return new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`).origin;
  } catch {
    return '';
  }
}

/**
 * Probes reachability of an ESP32-CAM target.
 *
 * Implements strict, honest diagnostics:
 * 1. Honors browser mixed-content restrictions.
 * 2. Distinguishes host reachability (network connection) from verified frame decodes.
 * 3. Never treats an opaque no-cors response as proof that a stream or snapshot route is valid.
 * 4. Never leaves a connection open: every probe closes its request before it returns. (Earlier
 *    versions left an MJPEG connection open after each successful probe of the stream URL.)
 *
 * Do not probe the stream URL while the live stream is attached: many ESP32 firmwares serve only
 * one stream client at a time. The dashboard's StreamConnection owns the live connection.
 */
export async function probeCameraConnection(
  targetUrl: string,
  timeoutMs: number = 4000,
  expectedKind: 'auto' | 'image' | 'host' = 'auto',
  signal?: AbortSignal
): Promise<ConnectionProbeResult> {
  const startTime = Date.now();
  const trimmedUrl = targetUrl?.trim();

  if (!trimmedUrl) {
    return {
      success: false,
      checkedUrl: '',
      probeType: 'fetch',
      timestamp: Date.now(),
      errorMessage: 'Camera URL is empty or not configured.',
      isMixedContent: false,
      hostReachable: false,
      frameVerified: false,
    };
  }

  // Detect HTTPS -> HTTP mixed content
  const mixedContent = isMixedContentRestricted(trimmedUrl);
  if (mixedContent) {
    return {
      success: false,
      checkedUrl: trimmedUrl,
      probeType: 'mixed_content_block',
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
      errorMessage:
        'Browser Mixed Content Block: This dashboard is served over HTTPS, which prevents modern browsers from loading unencrypted HTTP camera streams (http://192.168.x.x). Run Vite locally on HTTP (http://localhost:3000) or configure an SSL proxy.',
      isMixedContent: true,
      hostReachable: false,
      frameVerified: false,
    };
  }

  // Determine whether to probe as an image element or host reachability
  const isImageCandidate =
    expectedKind === 'image' ||
    (expectedKind === 'auto' &&
      (trimmedUrl.includes('/capture') ||
        trimmedUrl.includes('/stream') ||
        trimmedUrl.includes('/mjpeg') ||
        trimmedUrl.includes('.jpg')));

  if (isImageCandidate) {
    const imgResult = await probeWithImageElement(trimmedUrl, timeoutMs, signal);
    if (imgResult.success) {
      return {
        ...imgResult,
        latencyMs: Date.now() - startTime,
        hostReachable: true,
        frameVerified: true,
        details: 'Image frame successfully decoded by browser engine.',
      };
    }

    // Image probe failed or timed out: test if the host is at least reachable. Ask the host's root,
    // not the stream/snapshot URL again, so a failed probe does not open another stream connection.
    const hostCheck = await probeHostReachability(hostOrigin(trimmedUrl) || trimmedUrl, 2500, signal);
    return {
      success: false,
      checkedUrl: trimmedUrl,
      probeType: 'image',
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
      isMixedContent: false,
      hostReachable: hostCheck.hostReachable,
      frameVerified: false,
      errorMessage: hostCheck.hostReachable
        ? 'Camera host is reachable, but this endpoint failed to return a valid decodeable image frame.'
        : imgResult.errorMessage || 'Camera host is unreachable or timed out.',
    };
  }

  // Host Reachability Probe
  return probeHostReachability(trimmedUrl, timeoutMs, signal);
}

/**
 * Image-based probe that requests a frame and monitors onload / onerror.
 * Validates that an endpoint returns an actual, decodeable image.
 * The request is always released before the promise settles.
 */
export function probeWithImageElement(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ConnectionProbeResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const img = new Image();
    let settled = false;

    const cacheBuster = `_probe=${Date.now()}`;
    const testUrl = url.includes('?') ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;

    const base = (): Omit<ConnectionProbeResult, 'success' | 'hostReachable' | 'frameVerified'> => ({
      checkedUrl: url,
      probeType: 'image',
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
      isMixedContent: false,
    });

    const finish = (result: ConnectionProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Detach handlers BEFORE clearing the source (clearing fires an error event in Chromium),
      // then drop the source so a continuous MJPEG response does not keep its connection open.
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      resolve(result);
    };

    const onAbort = () =>
      finish({
        ...base(),
        success: false,
        errorMessage: 'Probe cancelled.',
        hostReachable: false,
        frameVerified: false,
      });

    const timer = setTimeout(() => {
      finish({
        ...base(),
        success: false,
        errorMessage: `Image probe timed out after ${timeoutMs / 1000}s.`,
        hostReachable: false,
        frameVerified: false,
      });
    }, timeoutMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    img.onload = () => {
      finish({ ...base(), success: true, hostReachable: true, frameVerified: true });
    };

    img.onerror = () => {
      finish({
        ...base(),
        success: false,
        errorMessage: 'Image probe received error from endpoint (failed to decode or 404/500).',
        hostReachable: false,
        frameVerified: false,
      });
    };

    img.src = testUrl;
  });
}

/**
 * Checks whether the target HTTP server host is responsive over the network.
 * Note: An opaque response proves network connectivity to the IP, but NOT that
 * video or snapshot streams are working.
 *
 * The request is aborted as soon as response headers arrive (or on timeout / cancellation), so the
 * probe never holds a connection open, even against a continuous stream URL.
 *
 * latencyMs is the browser's time from sending this request until the response headers arrived
 * (monotonic clock). It includes connection set-up, the camera's own processing time and any
 * queueing in the browser or the camera. It is NOT Wi-Fi latency and NOT a ping: browsers cannot
 * send ICMP, read signal strength or count lost packets. With mode 'no-cors' the status code and
 * headers are not readable, so any HTTP answer (even a 404) counts as "the host answered".
 */
export async function probeHostReachability(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ConnectionProbeResult> {
  const startTime = monotonicNow();
  const elapsed = () => Math.max(0, Math.round(monotonicNow() - startTime));
  const trimmedUrl = url.trim();

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const onExternalAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (signal?.aborted) onExternalAbort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const cacheBuster = `_probe=${Date.now()}`;
    const probeUrl = trimmedUrl.includes('?')
      ? `${trimmedUrl}&${cacheBuster}`
      : `${trimmedUrl}?${cacheBuster}`;

    await fetch(probeUrl, {
      method: 'GET',
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store',
    });

    return {
      success: true,
      checkedUrl: trimmedUrl,
      probeType: 'fetch',
      timestamp: Date.now(),
      latencyMs: elapsed(),
      isMixedContent: false,
      hostReachable: true,
      frameVerified: false,
      details: 'Camera host responded over network (opaque mode). Endpoint specifics unverified.',
    };
  } catch (error: unknown) {
    const latencyMs = elapsed();

    let errorDetail = 'Could not reach ESP32-CAM. Check IP address, Wi-Fi connection, and power.';
    if (cancelled) {
      errorDetail = 'Probe cancelled.';
    } else if (timedOut) {
      errorDetail = `Host connection timed out after ${timeoutMs / 1000}s. Device did not respond at this address.`;
    } else if (error instanceof Error) {
      errorDetail = error.message;
    }

    return {
      success: false,
      checkedUrl: trimmedUrl,
      probeType: 'fetch',
      timestamp: Date.now(),
      latencyMs,
      errorMessage: errorDetail,
      isMixedContent: false,
      hostReachable: false,
      frameVerified: false,
      failureKind: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
    // Release the connection: without this a response body that never ends (MJPEG) stays open.
    controller.abort();
  }
}
