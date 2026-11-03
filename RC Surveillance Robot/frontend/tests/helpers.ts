/**
 * Test doubles for StreamConnection. Nothing here touches the network or a real timer, so every
 * scenario is deterministic: time only moves when a test calls clock.advance().
 */

import {
  Clock,
  HostProbeResult,
  StreamCallbacks,
  StreamConnection,
  StreamConnectionOptions,
  StreamPolicy,
  StreamSession,
  StreamTarget,
  StreamTransport,
} from '../src/services/streamConnectionService';
import type { StreamMode } from '../src/types/camera';
import { ConnectionHistory, KeyValueStore } from '../src/services/connectionHistory';

export class FakeClock implements Clock {
  private t = 1_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Move time forward, running every timer that falls due (including ones scheduled meanwhile). */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.t = Math.max(this.t, timer.at);
      timer.fn();
    }
    this.t = target;
  }

  pendingTimers(): number {
    return this.timers.size;
  }
}

export class FakeSession implements StreamSession {
  closed = false;
  closeCount = 0;
  pollResult: 'ok' | 'broken' = 'ok';

  constructor(
    readonly url: string,
    readonly callbacks: StreamCallbacks,
    private readonly onClose: () => void,
    readonly withPoll: boolean,
  ) {
    if (withPoll) this.poll = () => (this.closed ? 'ok' : this.pollResult);
  }

  poll?: () => 'ok' | 'broken';

  close(): void {
    this.closeCount++;
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  // --- helpers that stand in for the browser / network ---
  firstFrame(): void {
    this.callbacks.onFirstFrame();
  }
  frame(): void {
    this.callbacks.onFrame?.();
  }
  error(message = 'connection reset'): void {
    this.callbacks.onError(message);
  }
  ended(message = 'the response ended.'): void {
    this.callbacks.onEnded?.(message);
  }
}

export class FakeTransport implements StreamTransport {
  sessions: FakeSession[] = [];
  /** Highest number of sessions that were open at the same moment. Must stay <= 1. */
  maxConcurrent = 0;
  private open_ = 0;
  /** When set, open() calls this right after creating the session, before returning it. */
  duringOpen: ((session: FakeSession) => void) | null = null;
  throwOnOpen: Error | null = null;
  withPoll = true;

  open(url: string, callbacks: StreamCallbacks): StreamSession {
    if (this.throwOnOpen) throw this.throwOnOpen;
    const session = new FakeSession(
      url,
      callbacks,
      () => {
        this.open_--;
      },
      this.withPoll,
    );
    this.sessions.push(session);
    this.open_++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.open_);
    this.duringOpen?.(session);
    return session;
  }

  get last(): FakeSession {
    const s = this.sessions[this.sessions.length - 1];
    if (!s) throw new Error('no session has been opened');
    return s;
  }

  openSessions(): FakeSession[] {
    return this.sessions.filter((s) => !s.closed);
  }
}

export interface HostProbeCall {
  baseUrl: string;
  signal: AbortSignal;
  /** Time limit the connection asked the probe to apply (Phase 2). */
  timeoutMs?: number;
  resolve: (result: HostProbeResult) => void;
  reject: (error: Error) => void;
}

export interface Harness {
  clock: FakeClock;
  transport: FakeTransport;
  conn: StreamConnection;
  hostCalls: HostProbeCall[];
  modesRequested: StreamMode[];
  notifications: number;
}

export const CAM: StreamTarget = {
  baseUrl: 'http://10.0.0.5',
  baseConfigured: true,
  url: 'http://10.0.0.5:81/stream',
  mode: 'img',
  mixedContent: false,
  autoReconnect: true,
  baseDelayMs: 5000,
};

export interface MakeOptions {
  target?: Partial<StreamTarget>;
  policy?: Partial<StreamPolicy>;
  /** Leave the connection unconfigured / not viewing so a test can drive that part itself. */
  start?: boolean;
  withHostProbe?: boolean;
  /** Phase 2: supply a history (for example one backed by a fake store). */
  history?: ConnectionHistory;
  /** Phase 2: shorthand - build the history on this store, using the harness clock. */
  store?: KeyValueStore;
  sessionId?: string;
  isPageVisible?: () => boolean;
}

export function make(options: MakeOptions = {}): Harness {
  const clock = new FakeClock();
  const transport = new FakeTransport();
  const hostCalls: HostProbeCall[] = [];
  const modesRequested: StreamMode[] = [];

  const opts: StreamConnectionOptions = {
    clock,
    policy: options.policy,
    history: options.history ?? (options.store ? new ConnectionHistory({ clock, store: options.store }) : undefined),
    sessionId: options.sessionId,
    isPageVisible: options.isPageVisible,
    createTransport: (mode) => {
      modesRequested.push(mode);
      return transport;
    },
  };
  if (options.withHostProbe !== false) {
    opts.probeHost = (baseUrl, signal, timeoutMs) =>
      new Promise<HostProbeResult>((resolve, reject) => {
        hostCalls.push({ baseUrl, signal, timeoutMs, resolve, reject });
      });
  }

  const conn = new StreamConnection(opts);
  const harness: Harness = { clock, transport, conn, hostCalls, modesRequested, notifications: 0 };
  conn.subscribe(() => {
    harness.notifications++;
  });

  if (options.start !== false) {
    conn.configure({ ...CAM, ...options.target });
    conn.setElementAvailable(true);
    conn.setViewing(true);
  }
  return harness;
}

/** Let queued promise callbacks (the host probe's .then) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Run a connect-timeout failure: nothing arrives for connectTimeoutMs. */
export const CONNECT_TIMEOUT_MS = 8000;

/** localStorage stand-in with failure injection. */
export class FakeStore implements KeyValueStore {
  data = new Map<string, string>();
  failGet: Error | null = null;
  failSet: Error | null = null;
  failRemove: Error | null = null;
  /** setItem throws when the value is longer than this (simulates a quota). */
  maxValueLength = Infinity;
  setCalls = 0;

  getItem(key: string): string | null {
    if (this.failGet) throw this.failGet;
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.setCalls++;
    if (this.failSet) throw this.failSet;
    if (value.length > this.maxValueLength) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    if (this.failRemove) throw this.failRemove;
    this.data.delete(key);
  }
}

/** A complete StreamHealth for tests of the pure summary/report code. */
export function healthFixture(overrides: Partial<import('../src/types/camera').StreamHealth> = {}): import('../src/types/camera').StreamHealth {
  return {
    status: 'connected',
    mode: 'img',
    evidence: 'first-frame-only',
    active: true,
    attempt: 0,
    maxAttempts: 6,
    totalReconnects: 0,
    connectedSince: 1_000_000,
    lastFrameAt: 1_000_000,
    frameStats: null,
    lastError: null,
    lastErrorAt: null,
    blockedReason: null,
    nextRetryAt: null,
    host: { reachable: null, checkedAt: null },
    hostChecking: false,
    recovery: { state: 'none', startedAt: null, finishedAt: null, attempts: 0, reason: null },
    events: [],
    failureKind: null,
    lastRecovery: null,
    interruptedRecovery: null,
    hostSamples: [],
    hostProbeTimeoutMs: 2500,
    hostProbeBlockedReason: null,
    autoMeasureMs: null,
    history: [],
    historyStorage: { status: 'persistent', reason: null },
    ...overrides,
  };
}
