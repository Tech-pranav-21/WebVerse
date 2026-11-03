/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MotionSnapshotLink } from '../types/motion';

/**
 * What happened to the optional snapshot of a motion or AI event, in words, with a colour tone for
 * the UI. `existingIds` are the gallery items that still exist, so a snapshot that was saved and
 * later deleted is described as such instead of pointing at nothing. null = no snapshot was asked for.
 */
export function describeSnapshotLink(
  link: MotionSnapshotLink,
  existingIds: ReadonlySet<string>,
): { text: string; tone: string } | null {
  const { status, snapshotId, note } = link;
  switch (status) {
    case 'off':
      return null;
    case 'pending':
      return { text: 'Snapshot: capturing...', tone: 'text-slate-400' };
    case 'saved':
      return snapshotId && !existingIds.has(snapshotId)
        ? { text: 'Snapshot was saved, then deleted from the gallery', tone: 'text-slate-400' }
        : { text: 'Snapshot saved to the gallery', tone: 'text-emerald-300' };
    case 'session-only':
      return { text: `Snapshot captured but not stored (session only)${note ? `: ${note}` : ''}`, tone: 'text-amber-300' };
    case 'failed':
      return { text: `Snapshot failed${note ? `: ${note}` : ''}`, tone: 'text-rose-300' };
    default:
      return { text: `Snapshot skipped${note ? `: ${note}` : ''}`, tone: 'text-slate-400' };
  }
}
