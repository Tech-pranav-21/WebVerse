/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { SnapshotNotice, SnapshotNoticeAction } from '../services/snapshotActions';

interface SnapshotNoticeBannerProps {
  notice: SnapshotNotice | null;
  onDismiss: () => void;
  /** Runs the one-click remedy a notice offers. */
  onAction?: (action: SnapshotNoticeAction) => void;
  className?: string;
}

const ACTION_LABELS: Record<SnapshotNoticeAction, string> = {
  'enable-capture': 'Allow snapshot capture',
};

/** Result of a snapshot operation: what happened, stated plainly, with a way to act on a failure. */
export const SnapshotNoticeBanner: React.FC<SnapshotNoticeBannerProps> = ({
  notice,
  onDismiss,
  onAction,
  className = '',
}) => {
  if (!notice) return null;
  const success = notice.kind === 'success';

  return (
    <div
      role={success ? 'status' : 'alert'}
      className={`px-3.5 py-2 rounded-lg border text-xs flex items-start gap-2 shadow-lg backdrop-blur-md ${
        success
          ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
          : 'bg-rose-950/80 border-rose-500/40 text-rose-200'
      } ${className}`}
    >
      {success ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-px" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-px" />
      )}
      <div className="space-y-1.5 min-w-0">
        <p className="leading-snug break-words">{notice.message}</p>
        {notice.action && onAction && (
          <button
            type="button"
            onClick={() => {
              onAction(notice.action as SnapshotNoticeAction);
              onDismiss();
            }}
            className="px-2 py-1 rounded bg-cyan-400 text-slate-900 font-medium hover:bg-cyan-300 transition-colors"
          >
            {ACTION_LABELS[notice.action]}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="p-0.5 -mr-1 text-current opacity-70 hover:opacity-100 shrink-0"
        aria-label="Dismiss message"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
