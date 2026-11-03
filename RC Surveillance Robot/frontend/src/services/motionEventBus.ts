/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MotionEvent } from '../types/motion';

/**
 * Lets the AI recognition panel hear about Motion Detection alerts without the two panels knowing
 * about each other. One instance lives in the Dashboard. A failing listener never affects the
 * motion detector or the other listeners.
 */
export class MotionEventBus {
  private listeners = new Set<(event: MotionEvent) => void>();

  subscribe(listener: (event: MotionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: MotionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener({ ...event, snapshot: { ...event.snapshot } });
      } catch {
        // one broken listener must not stop the others
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
