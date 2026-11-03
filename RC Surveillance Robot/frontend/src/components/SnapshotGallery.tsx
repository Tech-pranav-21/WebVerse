/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Download,
  Trash2,
  X,
  Camera,
  Loader2,
} from 'lucide-react';
import { SnapshotNoticeBanner } from './SnapshotNoticeBanner';
import { SnapshotImage } from './SnapshotImage';
import { BTN_DANGER, BTN_ICON, BTN_PRIMARY, Hint, Notice, Panel, StatusBadge, Tabs } from './ui';
import type { SmartSnapshotApi } from '../hooks/useSmartSnapshot';
import { MAX_SNAPSHOTS } from '../services/snapshotLibrary';

interface SnapshotGalleryProps {
  smart: SmartSnapshotApi;
  onNavigateToFeed: () => void;
  /** The camera stream a new still is read from ("Capture Still" here takes one frame, like Snapshot mode). */
  streamUrl: string;
}

type Period = 'all' | 'today' | 'week';

const DAY_MS = 24 * 60 * 60 * 1000;

const formatSize = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const SnapshotGallery: React.FC<SnapshotGalleryProps> = ({ smart, onNavigateToFeed, streamUrl }) => {
  const { items: snapshots, storage, busyIds } = smart;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [period, setPeriod] = useState<Period>('all');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // A capture started here is cancelled when the page is left, so no camera connection is left open.
  const captureAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      captureAbortRef.current?.abort();
    },
    [],
  );

  // Counts and filtering by capture time (local time: "Today" starts at midnight, "This Week" is the last 7 days).
  const now = Date.now();
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const inPeriod = (timestamp: number, p: Period) =>
    p === 'all' ? true : p === 'today' ? timestamp >= startOfToday : timestamp >= now - 7 * DAY_MS;
  const counts = {
    all: snapshots.length,
    today: snapshots.filter((s) => inPeriod(s.timestamp, 'today')).length,
    week: snapshots.filter((s) => inPeriod(s.timestamp, 'week')).length,
  };
  const visible = snapshots.filter((s) => inPeriod(s.timestamp, period));
  const selectedSnapshot = snapshots.find((s) => s.id === selectedId) ?? null;

  // "Clear Gallery" asks twice: it also deletes the stored copies, which cannot be undone.
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  // The enlarged view closes with Escape and puts the keyboard focus on its close button.
  useEffect(() => {
    if (!selectedSnapshot) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedSnapshot?.id]);

  const handleDelete = async (id: string) => {
    const removed = await smart.removeSnapshot(id);
    if (removed && id === selectedId) setSelectedId(null);
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    await smart.clearAll();
    setSelectedId(null);
  };

  // Takes one frame from the camera stream and saves it, exactly as Capture Still does in Snapshot mode.
  const handleCapture = async () => {
    captureAbortRef.current?.abort();
    const controller = new AbortController();
    captureAbortRef.current = controller;
    await smart.captureStill({ kind: 'stream', url: streamUrl, signal: controller.signal });
  };

  return (
    <div className="space-y-4">
      <Panel
        id="gallery"
        title="Snapshot Gallery"
        icon={ImageIcon}
        description="Stills captured from the ESP32-CAM video. Each one is real image data you can download as a JPEG file."
        actions={
          <>
            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={smart.capturing || !streamUrl}
              className={BTN_PRIMARY}
              title={streamUrl ? 'Take one frame from the camera stream and save it here' : 'Set the stream path in Settings first'}
            >
              {smart.capturing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{smart.capturing ? 'Capturing...' : 'Capture Still'}</span>
            </button>
            {snapshots.length > 0 && (
              <button type="button" onClick={() => void handleClear()} className={BTN_DANGER}>
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>{confirmClear ? 'Click again to delete all' : 'Clear Gallery'}</span>
              </button>
            )}
          </>
        }
      >
        <Tabs
          items={[
            { id: 'all', label: 'All', count: counts.all },
            { id: 'today', label: 'Today', count: counts.today },
            { id: 'week', label: 'This Week', count: counts.week },
          ]}
          value={period}
          onChange={(id) => setPeriod(id)}
          label="Show snapshots from"
          idBase="gallery"
        />
        {storage.status === 'loading' && (
          <p className="text-xs text-slate-400 flex items-center gap-1.5" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>Loading saved snapshots...</span>
          </p>
        )}
        {storage.status === 'persistent' && (
          <Hint>
            Saved in this browser (IndexedDB) on this computer, so they survive a page refresh. The newest {MAX_SNAPSHOTS} are
            kept; clearing this site's data in the browser removes them. Saving to the gallery is not the same as
            downloading: use Download to get the file.
          </Hint>
        )}
        {storage.status === 'memory-only' && (
          <Notice tone="warn">
            <p>
              Snapshots cannot be saved by this browser, so they are lost when the page is refreshed or closed. Download the
              ones you want to keep. {storage.reason}
            </p>
          </Notice>
        )}
      </Panel>

      <SnapshotNoticeBanner notice={smart.notice} onDismiss={smart.dismissNotice} />

      {/* Empty State */}
      {snapshots.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl px-6 py-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-lg bg-sunken border border-line mx-auto flex items-center justify-center text-cyan-400">
            <Camera className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h2 className="text-[15px] font-semibold text-white">No snapshots captured yet</h2>
            <p className="text-[13px] text-slate-400 leading-relaxed">
              On the Dashboard, press <strong className="text-slate-200">Capture Still</strong> or use Snapshot mode to save
              frames with their exact capture time.
            </p>
          </div>
          <button type="button" onClick={onNavigateToFeed} className={BTN_PRIMARY}>
            <span>Go to Dashboard</span>
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl px-6 py-10 text-center text-[13px] text-slate-400">
          No snapshots {period === 'today' ? 'from today' : 'from the last 7 days'}. Choose All to see the older ones.
        </div>
      ) : (
        /* Snapshot Grid */
        <ul
          id="gallery-panel"
          role="tabpanel"
          aria-labelledby={`gallery-tab-${period}`}
          className="grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {visible.map((item) => {
            const formattedTime = new Date(item.timestamp).toLocaleString(undefined, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            });
            const busy = busyIds.includes(item.id);

            return (
              <li key={item.id} className="bg-surface border border-line rounded-xl overflow-hidden flex flex-col shadow-[0_8px_30px_-18px_rgba(8,60,120,0.8)]">
                {/* Image: the whole picture opens the enlarged view */}
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="relative block w-full aspect-video bg-black overflow-hidden"
                  aria-label={`View snapshot from ${formattedTime} full size`}
                  title="View full size"
                >
                  <SnapshotImage
                    item={item}
                    alt={`ESP32-CAM snapshot ${formattedTime}`}
                    className="w-full h-full object-cover"
                  />
                </button>

                {/* Metadata & Actions */}
                <div className="p-3 flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="text-[13px] font-mono tabular-nums text-white">{formattedTime}</div>
                    <div className="text-xs text-slate-400 font-mono">
                      {item.width}×{item.height}, {formatSize(item.sizeBytes)}, JPEG
                    </div>
                    {item.persistence === 'saved' ? (
                      <StatusBadge tone="good">Saved</StatusBadge>
                    ) : (
                      <StatusBadge tone="warn" title={item.persistenceNote}>
                        Session only
                      </StatusBadge>
                    )}
                    {item.persistence === 'session' && (
                      <p className="text-xs text-amber-300 leading-snug">
                        Not stored: {item.persistenceNote}. Download it to keep it.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void smart.downloadSnapshot(item.id)}
                      disabled={busy}
                      className={`${BTN_ICON} border-edge bg-raised text-cyan-300 hover:bg-[#12294a]`}
                      title="Download as a JPEG file"
                      aria-label={`Download snapshot from ${formattedTime}`}
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      disabled={busy}
                      className={`${BTN_ICON} border-edge bg-raised text-rose-300 hover:bg-rose-500/15`}
                      title="Delete snapshot"
                      aria-label={`Delete snapshot from ${formattedTime}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Enlarged Snapshot Modal */}
      {selectedSnapshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          onClick={() => setSelectedId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-modal-title"
            className="max-w-4xl w-full max-h-full overflow-y-auto bg-surface border border-line rounded-xl shadow-2xl space-y-3 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
              <div className="space-y-1 min-w-0">
                <h2 id="snapshot-modal-title" className="text-[15px] font-semibold text-white">
                  ESP32-CAM still
                </h2>
                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-300">
                  <span className="font-mono tabular-nums">{new Date(selectedSnapshot.timestamp).toLocaleString()}</span>
                  {selectedSnapshot.persistence === 'saved' ? (
                    <StatusBadge tone="good">Saved in this browser</StatusBadge>
                  ) : (
                    <StatusBadge tone="warn">Session only</StatusBadge>
                  )}
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setSelectedId(null)}
                className={`${BTN_ICON} border-transparent text-slate-300 hover:bg-raised`}
                aria-label="Close"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
              <SnapshotImage
                item={selectedSnapshot}
                alt="Enlarged surveillance capture"
                className="w-full h-full object-contain"
              />
            </div>

            <SnapshotNoticeBanner notice={smart.notice} onDismiss={smart.dismissNotice} />

            <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
              <div className="text-xs font-mono text-slate-400 truncate max-w-md">
                {selectedSnapshot.width}×{selectedSnapshot.height}, {formatSize(selectedSnapshot.sizeBytes)},{' '}
                {selectedSnapshot.sourceUrl}
              </div>
              <button
                type="button"
                onClick={() => void smart.downloadSnapshot(selectedSnapshot.id)}
                disabled={busyIds.includes(selectedSnapshot.id)}
                className={BTN_PRIMARY}
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>Download JPEG</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
