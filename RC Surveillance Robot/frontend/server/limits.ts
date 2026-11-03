/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export type LimitDecision = { ok: true } | { ok: false; reason: 'minute' | 'day'; retryAfterSec: number };

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Caps how many requests this server forwards to Groq, all clients together (this is a
 * single-user dashboard, and behind the Vite proxy every client looks like 127.0.0.1 anyway).
 * Rolling windows: `perMinute` in the last 60 s and `perDay` in the last 24 h. It exists so that a
 * bug or an unwanted visitor cannot burn through the Groq quota.
 */
export class RollingLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly perDay: number,
    private readonly clock: Clock = systemClock,
  ) {}

  tryAcquire(): LimitDecision {
    const now = this.clock.now();
    this.prune(now);
    const lastMinute = this.stamps.filter((t) => now - t < MINUTE_MS);
    if (this.stamps.length >= this.perDay) {
      return { ok: false, reason: 'day', retryAfterSec: Math.max(1, Math.ceil((this.stamps[0] + DAY_MS - now) / 1000)) };
    }
    if (lastMinute.length >= this.perMinute) {
      return { ok: false, reason: 'minute', retryAfterSec: Math.max(1, Math.ceil((lastMinute[0] + MINUTE_MS - now) / 1000)) };
    }
    this.stamps.push(now);
    return { ok: true };
  }

  remainingToday(): number {
    this.prune(this.clock.now());
    return Math.max(0, this.perDay - this.stamps.length);
  }

  private prune(now: number): void {
    while (this.stamps.length > 0 && now - this.stamps[0] >= DAY_MS) this.stamps.shift();
  }
}

/** At most `max` requests being handled at once. */
export class ConcurrencyGate {
  private active = 0;

  constructor(private readonly max: number) {}

  /** Returns a release function, or null if the gate is full. The release is idempotent. */
  tryEnter(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }

  get inFlight(): number {
    return this.active;
  }
}
