/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CameraConfig, StreamHealth } from '../types/camera';
import { StreamConnection } from '../services/streamConnectionService';
import {
  BlobFrameRenderer,
  FetchMjpegTransport,
  ImgElementTransport,
} from '../services/streamTransports';
import { hostOrigin, probeHostReachability } from '../services/connectionService';
import { ConnectionHistory, KeyValueStore } from '../services/connectionHistory';

interface UseStreamConnectionArgs {
  config: CameraConfig;
  /** Fully resolved stream URL ('' when no stream path is configured). */
  streamUrl: string;
  isMixedContent: boolean;
  /** True while the Live Feed is on screen in stream mode. */
  viewing: boolean;
}

export interface UseStreamConnectionResult {
  health: StreamHealth;
  /** Ref callback for the <img> that displays the stream. Do not set `src` on it yourself. */
  attachImage: (element: HTMLImageElement | null) => void;
  reconnect: () => void;
  /** Phase 2: one camera-reachability measurement now. False if one is already running or impossible. */
  measureHost: () => boolean;
  /** Phase 2: opt-in periodic measurement (null = off). Always switch it off when leaving the page. */
  setAutoMeasure: (intervalMs: number | null) => void;
  /** Phase 2: erase the connection history (memory and browser storage). */
  clearHistory: () => void;
  /** Phase 3B: the element showing the stream right now (null when the Live Feed is not on screen). */
  getImage: () => HTMLImageElement | null;
}

/** Identifies this page load in the persisted history (one 'Dashboard opened' marker per load). */
const PAGE_SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The browser's localStorage if it really works (private windows and blocked site data can make
 * even setItem throw), otherwise null and the history lives in memory only.
 */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probeKey = '__rc_surveillance_storage_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Binds the framework-free StreamConnection to React. The connection lives as long as the
 * Dashboard, so status and diagnostics survive switching tabs; the actual network connection is
 * open only while the Live Feed is visible.
 */
export function useStreamConnection({
  config,
  streamUrl,
  isMixedContent,
  viewing,
}: UseStreamConnectionArgs): UseStreamConnectionResult {
  const imageRef = useRef<HTMLImageElement | null>(null);
  // Read when a transport is created; updated before configure() so a changed setting applies to the restart it causes.
  const corsCaptureRef = useRef(Boolean(config.captureCors));

  const [connection] = useState(
    () =>
      new StreamConnection({
        history: new ConnectionHistory({ store: browserStore() }),
        sessionId: PAGE_SESSION_ID,
        isPageVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
        createTransport: (mode) => {
          if (!imageRef.current) return null;
          const getElement = () => imageRef.current;
          if (mode === 'monitor') {
            const renderer = new BlobFrameRenderer(getElement);
            return new FetchMjpegTransport({
              onFrameBytes: (frame) => renderer.render(frame),
              onClose: () => renderer.reset(),
            });
          }
          return new ImgElementTransport(getElement, {
            crossOrigin: corsCaptureRef.current ? 'anonymous' : undefined,
          });
        },
        probeHost: async (baseUrl, signal, timeoutMs) => {
          const result = await probeHostReachability(hostOrigin(baseUrl) || baseUrl, timeoutMs ?? 2500, signal);
          return {
            reachable: Boolean(result.hostReachable),
            latencyMs: result.latencyMs,
            error: result.errorMessage,
            failure: result.failureKind,
          };
        },
      }),
  );

  const health = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);

  const baseConfigured = Boolean(config.baseUrl?.trim());
  const mode = config.frameMonitor ? 'monitor' : 'img';
  const baseDelayMs = Math.max(1, config.reconnectIntervalSec || 5) * 1000;

  const corsCapture = Boolean(config.captureCors);

  useEffect(() => {
    corsCaptureRef.current = corsCapture;
    connection.configure({
      baseUrl: config.baseUrl,
      baseConfigured,
      url: streamUrl,
      mode,
      mixedContent: isMixedContent,
      autoReconnect: config.autoReconnect,
      baseDelayMs,
      corsCapture,
    });
  }, [connection, config.baseUrl, baseConfigured, streamUrl, mode, isMixedContent, config.autoReconnect, baseDelayMs, corsCapture]);

  useEffect(() => {
    connection.setViewing(viewing);
  }, [connection, viewing]);

  // Without a stream path the only evidence available is host reachability.
  useEffect(() => {
    if (baseConfigured && !streamUrl) connection.checkHost('initial');
  }, [connection, baseConfigured, streamUrl, config.baseUrl]);

  useEffect(() => () => connection.shutdown(), [connection]);

  const attachImage = useCallback(
    (element: HTMLImageElement | null) => {
      imageRef.current = element;
      connection.setElementAvailable(Boolean(element));
    },
    [connection],
  );

  const reconnect = useCallback(() => connection.reconnect(), [connection]);
  const measureHost = useCallback(() => connection.measureHost(), [connection]);
  const setAutoMeasure = useCallback((ms: number | null) => connection.setAutoMeasure(ms), [connection]);
  const clearHistory = useCallback(() => connection.clearHistory(), [connection]);
  const getImage = useCallback(() => imageRef.current, []);

  return { health, attachImage, reconnect, measureHost, setAutoMeasure, clearHistory, getImage };
}
