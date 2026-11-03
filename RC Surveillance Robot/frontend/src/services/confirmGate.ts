/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Clock, systemClock } from './streamConnectionService';

/**
 * "Click again to confirm" for a destructive action (clearing motion history).
 *
 * The first request arms the gate; a second request while it is still armed performs the action;
 * if nobody confirms within `timeoutMs` the gate disarms by itself, so a stale question can never
 * be answered by accident later.
 */
export class ConfirmGate {
  private armed = false;
  private timer: unknown = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly timeoutMs = 6000,
    private readonly clock: Clock = systemClock,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** True while the "really do it?" question is showing. */
  getSnapshot = (): boolean => this.armed;

  /** Returns true if this call confirmed (and ran `action`); false if it only armed the gate. */
  request(action: () => void): boolean {
    if (this.armed) {
      this.disarm();
      action();
      return true;
    }
    this.armed = true;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.disarm();
    }, this.timeoutMs);
    this.notify();
    return false;
  }

  cancel(): void {
    this.disarm();
  }

  private disarm(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.armed) {
      this.armed = false;
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
