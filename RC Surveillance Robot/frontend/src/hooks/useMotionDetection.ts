/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MotionEvent, MotionSettings, MotionSnapshotLink, MotionState } from '../types/motion';
import { browserStore } from './useStreamConnection';
import type { SmartSnapshotApi } from './useSmartSnapshot';
import { CanvasFrameSampler } from '../services/frameSampler';
import { MotionHistory, MotionHistoryState } from '../services/motionHistory';
import { MotionMonitor, linkFromCaptureOutcome } from '../services/motionMonitor';
import { loadSettings, saveSettings } from '../services/motionSettings';
import { ConfirmGate } from '../services/confirmGate';

export interface UseMotionDetectionArgs {
  /** The element showing the live stream (see useStreamConnection). */
  getImage: () => HTMLImageElement | null;
  /** The Live Stream view is showing. */
  viewing: boolean;
  /** The stream connection reports "connected". */
  connected: boolean;
  statusLabel: string;
  streamUrl: string;
  /** Smart Snapshot "Allow snapshot capture" is on (tells the capture whether CORS was requested). */
  corsRequested: boolean;
  smart: SmartSnapshotApi;
  /** Told about every new motion alert (the AI recognition panel listens through this). */
  onMotionEvent?: (event: MotionEvent) => void;
}

export interface MotionApi {
  state: MotionState;
  history: MotionHistoryState;
  /** True while "Click again to clear" is showing. */
  confirmingClear: boolean;
  start: () => void;
  stop: () => void;
  configure: (patch: Partial<MotionSettings>) => void;
  /** First call asks for confirmation, a second call within a few seconds clears. */
  requestClearHistory: () => void;
  cancelClearHistory: () => void;
}

/**
 * Binds the framework-free MotionMonitor to React. The monitor reads the stream element the
 * dashboard already shows (no second camera connection) and lives only as long as the panel: when
 * the panel unmounts (the Live Feed tab is left) the timer, canvas and listeners are released.
 */
export function useMotionDetection(args: UseMotionDetectionArgs): MotionApi {
  // The monitor is created once but must always see the latest props.
  const argsRef = useRef(args);
  argsRef.current = args;

  const [{ monitor, history, gate }] = useState(() => {
    const store = browserStore();
    const motionHistory = new MotionHistory({ store });
    const motionMonitor = new MotionMonitor({
      sampler: new CanvasFrameSampler(() => argsRef.current.getImage()),
      history: motionHistory,
      settings: loadSettings(store),
      persistSettings: (settings) => void saveSettings(store, settings),
      onMotionEvent: (event) => argsRef.current.onMotionEvent?.(event),
      captureSnapshot: async (): Promise<MotionSnapshotLink> => {
        const a = argsRef.current;
        const outcome = await a.smart.captureStill(
          {
            kind: 'live',
            image: a.getImage(),
            connected: a.connected,
            statusLabel: a.statusLabel,
            sourceUrl: a.streamUrl,
            corsRequested: a.corsRequested,
          },
          { quiet: true },
        );
        return linkFromCaptureOutcome(outcome);
      },
    });
    return { monitor: motionMonitor, history: motionHistory, gate: new ConfirmGate() };
  });

  const { viewing, connected, statusLabel } = args;
  useEffect(() => {
    monitor.setCamera({ viewing, connected, statusLabel });
  }, [monitor, viewing, connected, statusLabel]);

  // Leaving the page: stop the timer, free the canvas, remove the visibility listener.
  useEffect(
    () => () => {
      monitor.shutdown();
      gate.cancel();
    },
    [monitor, gate],
  );

  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getSnapshot);
  const historyState = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const confirmingClear = useSyncExternalStore(gate.subscribe, gate.getSnapshot, gate.getSnapshot);

  return {
    state,
    history: historyState,
    confirmingClear,
    start: () => monitor.start(),
    stop: () => monitor.stop(),
    configure: (patch) => monitor.configure(patch),
    requestClearHistory: () => void gate.request(() => history.clear()),
    cancelClearHistory: () => gate.cancel(),
  };
}
