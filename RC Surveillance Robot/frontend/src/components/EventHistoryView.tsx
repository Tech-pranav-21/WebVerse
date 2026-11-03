/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Camera, ListChecks, ScanSearch, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SnapshotItem, StreamHealth } from '../types/camera';
import type { SmartSnapshotApi } from '../hooks/useSmartSnapshot';
import { browserStore } from '../hooks/useStreamConnection';
import { useNow } from '../hooks/useNow';
import { MotionHistory, MotionHistoryState } from '../services/motionHistory';
import { AiHistory, AiHistoryState } from '../services/aiHistory';
import { CONNECTION_EVENT_LABELS } from '../services/connectionHistory';
import { describeSnapshotLink } from '../services/snapshotLinkText';
import { formatEventTime } from '../services/streamStatusText';
import { SENSITIVITY_PRESETS, REGION_LABELS } from '../services/motionSettings';
import { CATEGORY_LABELS } from '../services/aiSettings';
import { SnapshotImage } from './SnapshotImage';
import { BTN_PRIMARY, BTN_SECONDARY, BadgeTone, Hint, Notice, Panel, Tabs } from './ui';

type EventKind = 'motion' | 'snapshot' | 'ai' | 'connection';

/** Which events the page shows: everything, or one kind. */
export type EventFilter = EventKind | 'all';

interface EventHistoryViewProps {
  health: StreamHealth;
  smart: SmartSnapshotApi;
  onNavigateToFeed: () => void;
  /** The filter the page opens with (the "View All" buttons of the motion and AI cards use it). */
  initialFilter?: EventFilter;
}

interface TimelineEvent {
  key: string;
  kind: EventKind;
  t: number;
  title: string;
  /** Main sentence under the title. */
  detail?: string;
  /** Smaller supporting line. */
  meta?: string;
  /** What happened to a linked snapshot, in words. */
  link?: { text: string; tone: string } | null;
  tone: BadgeTone;
  thumb?: SnapshotItem;
}

const KIND_META: Record<EventKind, { label: string; icon: LucideIcon }> = {
  motion: { label: 'Motion', icon: Activity },
  snapshot: { label: 'Snapshots', icon: Camera },
  ai: { label: 'AI recognition', icon: ScanSearch },
  connection: { label: 'Connection', icon: Server },
};

const ICON_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  accent: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
};

const PAGE_SIZE = 50;

/** What this browser saved from earlier AI Detection visits. Read-only: nothing here writes to storage. */
function readSavedHistories(): { motion: MotionHistoryState; ai: AiHistoryState } {
  const store = browserStore();
  return {
    motion: new MotionHistory({ store }).getSnapshot(),
    ai: new AiHistory({ store }).getSnapshot(),
  };
}

function dayLabel(t: number, now: number): string {
  const day = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diffDays = Math.round((day(now) - day(t)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One timeline of what the dashboard recorded: motion alerts, snapshots, AI recognitions and
 * connection changes, newest first. Every row comes from a record that already exists (the motion
 * and AI histories saved in this browser, the snapshot gallery, the connection history); nothing
 * is generated. Motion detection and AI analysis only run while the AI Detection page is open, so this
 * page re-reads what they saved each time it is opened.
 */
export const EventHistoryView: React.FC<EventHistoryViewProps> = ({ health, smart, onNavigateToFeed, initialFilter = 'all' }) => {
  const now = useNow(true, 30_000);
  const [saved, setSaved] = useState(readSavedHistories);
  const [filter, setFilter] = useState<EventFilter>(initialFilter);
  const [shown, setShown] = useState(PAGE_SIZE);

  // Another tab may have recorded events meanwhile.
  useEffect(() => {
    const reload = () => setSaved(readSavedHistories());
    window.addEventListener('storage', reload);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('focus', reload);
    };
  }, []);

  const galleryById = useMemo(() => new Map(smart.items.map((i) => [i.id, i])), [smart.items]);
  const galleryIds = useMemo(() => new Set(galleryById.keys()), [galleryById]);

  const events = useMemo(() => {
    const list: TimelineEvent[] = [];

    for (const e of saved.motion.events) {
      list.push({
        key: `motion-${e.id}`,
        kind: 'motion',
        t: e.t,
        title: 'Motion detected',
        detail: `${e.changedPercent}% of the picture changed (alert level ${e.thresholdPercent}%)`,
        meta: `${SENSITIVITY_PRESETS[e.sensitivity].label} sensitivity, ${REGION_LABELS[e.region].toLowerCase()}, ${e.confirmFrames} frame${e.confirmFrames === 1 ? '' : 's'} confirmed`,
        link: describeSnapshotLink(e.snapshot, galleryIds),
        tone: 'warn',
        thumb: e.snapshot.snapshotId ? galleryById.get(e.snapshot.snapshotId) : undefined,
      });
    }

    for (const item of smart.items) {
      list.push({
        key: `snapshot-${item.id}`,
        kind: 'snapshot',
        t: item.timestamp,
        title: 'Snapshot captured',
        detail: `${item.width}×${item.height}, ${Math.max(1, Math.round(item.sizeBytes / 1024))} KB`,
        meta: item.persistence === 'saved' ? 'Saved in this browser' : `Session only: ${item.persistenceNote ?? 'not stored'}`,
        tone: item.persistence === 'saved' ? 'neutral' : 'warn',
        thumb: item,
      });
    }

    for (const e of saved.ai.events) {
      const failed = e.status === 'failed';
      const categoryName = e.category === 'none' ? 'Nothing recognised' : e.category in CATEGORY_LABELS ? CATEGORY_LABELS[e.category as keyof typeof CATEGORY_LABELS] : e.category;
      list.push({
        key: `ai-${e.id}`,
        kind: 'ai',
        t: e.t,
        title: failed ? 'AI recognition failed' : `AI recognition: ${categoryName}${e.matched ? ' (matched your filters)' : ''}`,
        detail: failed ? e.error?.message : e.summary || undefined,
        meta: `${e.trigger === 'motion' ? 'Triggered by motion' : 'Manual'}${!failed && e.objects.length > 0 ? `, ${e.objects.map((o) => `${o.label}${o.uncertain ? ' (not sure)' : ''}`).join(', ')}` : ''}`,
        link: describeSnapshotLink(e.snapshot, galleryIds),
        tone: failed ? 'bad' : e.matched ? 'accent' : 'neutral',
        thumb: e.snapshot.snapshotId ? galleryById.get(e.snapshot.snapshotId) : undefined,
      });
    }

    // Connection history also lists routine steps (connecting, first frame, settings changed); only
    // problems and recoveries are events here. The complete log stays on the Diagnostics page.
    for (const e of health.history) {
      if (e.type === 'session_started' || e.type === 'stream_first_frame' || e.severity === 'info') continue;
      list.push({
        key: `connection-${e.id}`,
        kind: 'connection',
        t: e.t,
        title: CONNECTION_EVENT_LABELS[e.type],
        detail: e.message,
        meta: e.count > 1 ? `Happened ${e.count} times, last at ${formatEventTime(e.lastT, now)}` : undefined,
        tone: e.severity === 'error' ? 'bad' : e.severity === 'warn' ? 'warn' : 'good',
      });
    }

    return list.sort((a, b) => b.t - a.t);
  }, [saved, smart.items, health.history, galleryById, galleryIds, now]);

  const counts = useMemo(() => {
    const c: Record<EventKind, number> = { motion: 0, snapshot: 0, ai: 0, connection: 0 };
    for (const e of events) c[e.kind] += 1;
    return c;
  }, [events]);

  const visible = (filter === 'all' ? events : events.filter((e) => e.kind === filter)).slice(0, shown);
  const total = filter === 'all' ? events.length : counts[filter];

  // Why a source may be incomplete, in the words its own storage gave.
  const storageNotes = [
    saved.motion.storage.status === 'memory-only' && saved.motion.storage.reason,
    saved.ai.storage.status === 'memory-only' && saved.ai.storage.reason,
    smart.storage.status === 'memory-only' && smart.storage.reason,
    health.historyStorage.status === 'memory-only' && health.historyStorage.reason,
  ].filter((n): n is string => typeof n === 'string' && n.length > 0);

  let lastDay = '';

  return (
    <div className="space-y-4">
      <Panel
        id="events"
        title="Event history"
        icon={ListChecks}
        description="Motion alerts, snapshots, AI recognitions and connection problems recorded by this dashboard in this browser, newest first."
      >
        <Tabs
          items={(['all', 'motion', 'snapshot', 'ai', 'connection'] as const).map((f) => ({
            id: f,
            label: f === 'all' ? 'All events' : KIND_META[f].label,
            count: f === 'all' ? events.length : counts[f],
          }))}
          value={filter}
          onChange={(id) => {
            setFilter(id);
            setShown(PAGE_SIZE);
          }}
          label="Filter events"
          idBase="events"
        />

        {storageNotes.map((note) => (
          <Notice key={note} tone="warn">
            <p>{note}</p>
          </Notice>
        ))}
      </Panel>

      {events.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl px-6 py-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-md bg-sunken border border-line mx-auto flex items-center justify-center text-slate-400">
            <ListChecks className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h2 className="text-[15px] font-semibold text-white">No events recorded yet</h2>
            <p className="text-[13px] text-slate-400 leading-relaxed">
              Events appear here when motion is detected, a snapshot is captured, a frame is analyzed or the camera
              connection has a problem. Start motion detection on the AI Detection page or capture a still on the Dashboard.
            </p>
          </div>
          <button type="button" onClick={onNavigateToFeed} className={BTN_PRIMARY}>
            Go to Dashboard
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl px-6 py-8 text-center text-[13px] text-slate-400">
          No {KIND_META[filter as EventKind].label.toLowerCase()} events recorded yet.
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl">
          <ol aria-label="Events, newest first" className="divide-y divide-line">
            {visible.map((e) => {
              const day = dayLabel(e.t, now);
              const showDay = day !== lastDay;
              lastDay = day;
              const { icon: Icon, label } = KIND_META[e.kind];
              return (
                <li key={e.key}>
                  {showDay && (
                    <div className="px-4 py-2 bg-sunken text-xs font-medium text-slate-300 border-b border-line first:rounded-t-lg">
                      {day}
                    </div>
                  )}
                  <div className="flex gap-3 px-4 py-3">
                    <div
                      className={`w-9 h-9 shrink-0 rounded-md border flex items-center justify-center ${ICON_TONE[e.tone]}`}
                      title={label}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span className="sr-only">{label}</span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="text-[13px] font-medium text-white">{e.title}</span>
                        <time dateTime={new Date(e.t).toISOString()} className="text-xs font-mono tabular-nums text-slate-400">
                          {new Date(e.t).toLocaleTimeString(undefined, { hour12: false })}
                        </time>
                      </div>
                      {e.detail && <p className="text-[13px] text-slate-300 break-words">{e.detail}</p>}
                      {e.meta && <p className="text-xs text-slate-400 break-words">{e.meta}</p>}
                      {e.link && <p className={`text-xs ${e.link.tone}`}>{e.link.text}</p>}
                    </div>
                    {e.thumb && (
                      <SnapshotImage
                        item={e.thumb}
                        alt={`Snapshot from ${new Date(e.thumb.timestamp).toLocaleTimeString(undefined, { hour12: false })}`}
                        className="w-24 sm:w-32 aspect-video shrink-0 self-start rounded object-cover bg-black"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {total > visible.length && (
            <div className="p-3 border-t border-line text-center">
              <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className={BTN_SECONDARY}>
                Show {Math.min(PAGE_SIZE, total - visible.length)} older events
              </button>
            </div>
          )}
        </div>
      )}

      <Hint>
        Events are read from this browser: the newest 100 motion alerts, 50 AI recognitions, 100 snapshots and the connection
        history. Motion detection and AI analysis only run while the AI Detection page is open, so new events show up here after you
        come back. The complete connection log is on the Diagnostics page.
      </Hint>
    </div>
  );
};
