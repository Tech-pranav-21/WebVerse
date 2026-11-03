/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AiRecognizerState, AiSettings } from '../types/ai';
import { browserStore } from './useStreamConnection';
import type { SmartSnapshotApi } from './useSmartSnapshot';
import { createAiClient } from '../services/aiClient';
import { AiHistory, AiHistoryState } from '../services/aiHistory';
import { AiRecognizer, AnalyzeOutcome, FrameOutcome } from '../services/aiRecognizer';
import { loadAiSettings, saveAiSettings } from '../services/aiSettings';
import { ConfirmGate } from '../services/confirmGate';
import { captureFrameFromImage, isCaptureFailure } from '../services/frameCapture';
import { linkFromCaptureOutcome } from '../services/motionMonitor';
import type { MotionEventBus } from '../services/motionEventBus';
import { describeCaptureFailure } from '../services/snapshotActions';

export interface UseAiRecognitionArgs {
  /** The element showing the live stream (see useStreamConnection). */
  getImage: () => HTMLImageElement | null;
  /** The Live Stream view is showing. */
  viewing: boolean;
  /** The stream connection reports "connected". */
  connected: boolean;
  statusLabel: string;
  streamUrl: string;
  /** Settings > "Allow snapshot capture" is on (needed to read the picture's pixels). */
  corsRequested: boolean;
  smart: SmartSnapshotApi;
  /** Motion Detection alerts arrive here. */
  motionBus: MotionEventBus;
}

export interface AiApi {
  state: AiRecognizerState;
  history: AiHistoryState;
  /** True while "Click again to clear" is showing. */
  confirmingClear: boolean;
  analyze: () => Promise<AnalyzeOutcome>;
  configure: (patch: Partial<AiSettings>) => void;
  refreshBackend: () => Promise<void>;
  requestClearHistory: () => void;
  cancelClearHistory: () => void;
}

/**
 * Binds the framework-free AiRecognizer to React. It reads the stream element the dashboard
 * already shows (no second camera connection). Nothing is sent to Groq until the user presses
 * Analyze or has enabled automatic analysis; asking the backend for its status sends no image.
 */
export function useAiRecognition(args: UseAiRecognitionArgs): AiApi {
  const argsRef = useRef(args);
  argsRef.current = args;

  const [{ recognizer, history, gate }] = useState(() => {
    const store = browserStore();
    const aiHistory = new AiHistory({ store });
    const aiRecognizer = new AiRecognizer({
      client: createAiClient(),
      history: aiHistory,
      settings: loadAiSettings(store),
      persistSettings: (settings) => void saveAiSettings(store, settings),
      getFrame: async (): Promise<FrameOutcome> => {
        const a = argsRef.current;
        if (!a.viewing) {
          return { ok: false, blocked: false, message: 'The Live Stream view is not showing, so there is no picture to analyze.' };
        }
        if (!a.connected) {
          return { ok: false, blocked: false, message: `The camera stream is not connected (${a.statusLabel}), so the picture on screen may be an old frame.` };
        }
        const img = a.getImage();
        const result = await captureFrameFromImage(img ?? { complete: false, naturalWidth: 0, naturalHeight: 0 });
        if (isCaptureFailure(result)) {
          const text = describeCaptureFailure(result.failure, { corsRequested: a.corsRequested, live: true });
          return { ok: false, blocked: result.failure.kind === 'blocked', message: text.message, action: text.action };
        }
        return { ok: true, frame: result.frame };
      },
      // The exact frame that was analysed is what gets kept, through the Smart Snapshot gallery and storage.
      saveSnapshot: async (frame) => {
        const a = argsRef.current;
        return linkFromCaptureOutcome(await a.smart.saveFrame(frame, a.streamUrl, { quiet: true }));
      },
    });
    return { recognizer: aiRecognizer, history: aiHistory, gate: new ConfirmGate() };
  });

  // Ask the (local) backend whether it is running; this sends no image.
  useEffect(() => {
    void recognizer.refreshBackend();
  }, [recognizer]);

  useEffect(() => args.motionBus.subscribe((event) => void recognizer.handleMotionEvent(event)), [args.motionBus, recognizer]);

  const { connected } = args;
  useEffect(() => {
    if (connected) recognizer.notifyStreamReconnected();
  }, [recognizer, connected]);

  // Leaving the page: abort a request in flight and ignore whatever comes back.
  useEffect(
    () => () => {
      recognizer.shutdown();
      gate.cancel();
    },
    [recognizer, gate],
  );

  const state = useSyncExternalStore(recognizer.subscribe, recognizer.getSnapshot, recognizer.getSnapshot);
  const historyState = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const confirmingClear = useSyncExternalStore(gate.subscribe, gate.getSnapshot, gate.getSnapshot);

  return {
    state,
    history: historyState,
    confirmingClear,
    analyze: () => recognizer.analyzeNow(),
    configure: (patch) => recognizer.configure(patch),
    refreshBackend: () => recognizer.refreshBackend(),
    requestClearHistory: () => void gate.request(() => history.clear()),
    cancelClearHistory: () => gate.cancel(),
  };
}
