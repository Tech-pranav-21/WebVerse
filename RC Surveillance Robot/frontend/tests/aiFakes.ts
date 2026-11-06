/**
 * Test doubles for AI recognition on the browser side. The backend and Groq are never contacted:
 * the "client" is a scriptable fake. Results prove the recognizer's rules, not what a real model says.
 */

import type { AiBackendStatus, RecognizeSuccess, RecognizedObject } from '../server/protocol';
import { AiClientError } from '../src/services/aiClient';
import { AiHistory } from '../src/services/aiHistory';
import { AiRecognizer, AiRecognizerDeps, FrameOutcome } from '../src/services/aiRecognizer';
import { normalizeAiSettings } from '../src/services/aiSettings';
import type { CapturedFrame } from '../src/services/frameCapture';
import type { AiSettings } from '../src/types/ai';
import type { MotionEvent, MotionSnapshotLink } from '../src/types/motion';
import { FakeClock, FakeStore } from './helpers';
import { jpegBlob } from './snapshotFakes';

export const personObject: RecognizedObject = { label: 'person', category: 'person', description: 'An adult standing near the door.', uncertain: false };
export const carObject: RecognizedObject = { label: 'car', category: 'vehicle', description: 'A parked grey car.', uncertain: false };
export const dogObject: RecognizedObject = { label: 'dog', category: 'animal', description: 'A brown dog.', uncertain: false };
export const chairObject: RecognizedObject = { label: 'chair', category: 'other', description: 'A wooden chair.', uncertain: false };

export function okResponse(objects: RecognizedObject[] = [personObject, carObject], summary = 'A person stands near a parked car.'): RecognizeSuccess {
  return {
    ok: true,
    requestId: 'req-1',
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    result: { summary, objects },
    usage: { promptTokens: 2400, completionTokens: 120 },
    latencyMs: 1800,
  };
}

export function readyStatus(overrides: Partial<AiBackendStatus> = {}): AiBackendStatus {
  const groqProvider = { id: 'groq' as const, name: 'Groq', configured: true, model: 'qwen/qwen3.8-27b', availableModels: ['qwen/qwen3.8-27b'] };
  const geminiProvider = { id: 'gemini' as const, name: 'Google Gemini', configured: false, model: 'gemini-2.5-flash', availableModels: ['gemini-2.5-flash'] };
  const openaiProvider = { id: 'openai' as const, name: 'OpenAI', configured: false, model: 'gpt-4o-mini', availableModels: ['gpt-4o-mini'] };
  return {
    ok: true,
    provider: 'groq',
    activeProvider: 'groq',
    configured: true,
    model: 'qwen/qwen3.8-27b',
    preview: true,
    providers: { groq: groqProvider, gemini: geminiProvider, openai: openaiProvider },
    maxImageBytes: 1_500_000,
    mimeTypes: ['image/jpeg'],
    limits: { perMinute: 6, perDay: 100, remainingToday: 100 },
    ...overrides,
  } as AiBackendStatus;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface RecognizeCall {
  blob: Blob;
  signal?: AbortSignal;
}

/** A scriptable stand-in for the backend client. */
export class FakeAiClient {
  statusCalls = 0;
  recognizeCalls: RecognizeCall[] = [];
  statusImpl: () => Promise<AiBackendStatus> = async () => readyStatus();
  recognizeImpl: (call: RecognizeCall) => Promise<RecognizeSuccess> = async () => okResponse();

  status(): Promise<AiBackendStatus> {
    this.statusCalls++;
    return this.statusImpl();
  }

  recognize(blob: Blob, optionsOrSignal?: { provider?: any; model?: any } | AbortSignal, maybeSignal?: AbortSignal): Promise<RecognizeSuccess> {
    const signal: AbortSignal | undefined =
      optionsOrSignal && 'aborted' in optionsOrSignal ? (optionsOrSignal as AbortSignal) : maybeSignal;
    const call = { blob, signal };
    this.recognizeCalls.push(call);
    return this.recognizeImpl(call);
  }

  /** Make the next recognition wait until the test says so; aborting rejects it like the real client does. */
  hold(): { resolve: (r?: RecognizeSuccess) => void; reject: (e: AiClientError) => void } {
    const d = deferred<RecognizeSuccess>();
    this.recognizeImpl = (call) => {
      call.signal?.addEventListener('abort', () => d.reject(new AiClientError('cancelled', 'The request was cancelled.')));
      return d.promise;
    };
    return { resolve: (r = okResponse()) => d.resolve(r), reject: (e) => d.reject(e) };
  }

  failWith(code: ConstructorParameters<typeof AiClientError>[0], message = `fail:${code}`, retryAfterSec?: number): void {
    this.recognizeImpl = async () => {
      throw new AiClientError(code, message, retryAfterSec);
    };
  }
}

export function makeFrame(size = 30_000, capturedAt = 5000): CapturedFrame {
  return { blob: jpegBlob(size), width: 640, height: 480, capturedAt };
}

export function motionEvent(id: string, snapshot: MotionSnapshotLink = { status: 'off' }, t = 1000): MotionEvent {
  return {
    id,
    t,
    changedPercent: 7.5,
    thresholdPercent: 4,
    pixelThreshold: 28,
    sensitivity: 'medium',
    confirmFrames: 2,
    region: 'full',
    snapshot,
  };
}

export interface AiSetupOptions {
  settings?: Partial<AiSettings>;
  frame?: () => Promise<FrameOutcome>;
  saveSnapshot?: AiRecognizerDeps['saveSnapshot'] | null;
  store?: FakeStore;
}

/** Enabled, acknowledged, automatic mode ON, 60 s cooldown: the common case for motion tests. */
export const AUTO_ON: Partial<AiSettings> = { enabled: true, autoAcknowledged: true, autoOnMotion: true, cooldownSec: 60 };

export function setupAi(options: AiSetupOptions = {}) {
  const clock = new FakeClock();
  const client = new FakeAiClient();
  const store = options.store ?? new FakeStore();
  const history = new AiHistory({ store });
  const saved: AiSettings[] = [];
  const frame = makeFrame();
  const calls = { frames: 0, saves: [] as CapturedFrame[] };
  let n = 0;

  const getFrame = async (): Promise<FrameOutcome> => {
    calls.frames++;
    return options.frame ? options.frame() : { ok: true, frame };
  };
  const saveSnapshot =
    options.saveSnapshot === null
      ? undefined
      : options.saveSnapshot ??
        (async (f: CapturedFrame): Promise<MotionSnapshotLink> => {
          calls.saves.push(f);
          return { status: 'saved', snapshotId: `snap-${calls.saves.length}` };
        });

  const recognizer = new AiRecognizer({
    client,
    history,
    getFrame,
    saveSnapshot,
    clock,
    settings: normalizeAiSettings({ enabled: true, ...options.settings }),
    persistSettings: (s) => saved.push(s),
    makeId: () => `ai${++n}`,
  });

  const states: Array<ReturnType<typeof recognizer.getSnapshot>> = [];
  recognizer.subscribe(() => states.push(recognizer.getSnapshot()));

  return {
    clock,
    client,
    store,
    history,
    recognizer,
    frame,
    calls,
    saved,
    states,
    state: () => recognizer.getSnapshot(),
    events: () => history.getSnapshot().events,
  };
}

export type AiHarness = ReturnType<typeof setupAi>;
