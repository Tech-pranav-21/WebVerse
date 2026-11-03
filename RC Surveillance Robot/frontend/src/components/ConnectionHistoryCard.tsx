/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { ConnectionEvent, StreamEventLevel, StreamHealth } from '../types/camera';
import { useNow } from '../hooks/useNow';
import { formatEventTime } from '../services/streamStatusText';
import { CONNECTION_EVENT_LABELS, HISTORY_MAX_EVENTS } from '../services/connectionHistory';
import { BTN_DANGER_SOLID, BTN_SECONDARY, Hint, ListWell, Panel } from './ui';

interface ConnectionHistoryCardProps {
  health: StreamHealth;
  onClear: () => void;
}

const SEVERITY_TEXT: Record<StreamEventLevel, string> = {
  info: 'text-slate-300',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

const SEVERITY_BADGE: Record<StreamEventLevel, string> = {
  info: 'border-slate-700 text-slate-300',
  ok: 'border-emerald-500/30 text-emerald-300',
  warn: 'border-amber-500/30 text-amber-300',
  error: 'border-rose-500/30 text-rose-300',
};

type Filter = 'all' | 'problems';

/**
 * Connection history: the curated, de-duplicated record of what happened to the stream and the
 * camera, newest first, saved in this browser. See services/connectionHistory.ts for the rules.
 */
export const ConnectionHistoryCard: React.FC<ConnectionHistoryCardProps> = ({ health, onClear }) => {
  const now = useNow(true, 1000);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);

  // A pending "really clear?" question expires, so it cannot be answered by accident later.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const all = health.history;
  const visible = (filter === 'problems' ? all.filter((e) => e.severity === 'warn' || e.severity === 'error') : all)
    .slice()
    .reverse();
  const problems = all.filter((e) => e.severity === 'warn' || e.severity === 'error').length;
  const storage = health.historyStorage;

  return (
    <Panel
      id="connection-history"
      title="Connection history"
      icon={History}
      description={
        <>
          What happened to the stream and the camera, newest first. Repeats during one failure are counted, not listed again.{' '}
          <span className="text-slate-300">
            {all.length} event{all.length === 1 ? '' : 's'}, {problems} problem{problems === 1 ? '' : 's'}.
          </span>
        </>
      }
      actions={
        <>
          <div className="inline-flex rounded-md border border-edge overflow-hidden" role="group" aria-label="Filter events">
            {(['all', 'problems'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`h-9 px-3 text-[13px] font-medium transition-colors ${filter === f ? 'bg-[#1d4f7e] text-white' : 'bg-raised text-slate-300 hover:text-white'}`}
              >
                {f === 'all' ? 'All' : 'Problems'}
              </button>
            ))}
          </div>
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onClear();
                }}
                className={BTN_DANGER_SOLID}
              >
                Yes, clear history
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={all.length === 0}
              className={BTN_SECONDARY}
            >
              <Trash2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span>Clear history</span>
            </button>
          )}
        </>
      }
    >
      <ListWell label="Connection events" maxHeight="max-h-80">
        {visible.length === 0 ? (
          <li className="p-3 text-[13px] text-slate-400 leading-relaxed">
            {all.length === 0
              ? 'No connection events recorded. Events appear when the stream connects, drops, stalls, reconnects, or the camera stops or starts answering.'
              : 'No problems recorded. Switch to "All" to see everything.'}
          </li>
        ) : (
          visible.map((e) => <EventRow key={e.id} event={e} now={now} />)
        )}
      </ListWell>

      {storage.status === 'persistent' ? (
        <Hint>
          {`Saved in this browser (the newest ${HISTORY_MAX_EVENTS} events). It is not shared with other browsers or devices, tabs do not synchronise it, and the browser or you can clear it.${storage.reason ? ` ${storage.reason}` : ''}`}
        </Hint>
      ) : (
        <p className="text-xs leading-relaxed text-amber-300">
          {`Not saved. ${storage.reason ?? 'This browser did not allow storage, so the history is kept only until this page closes.'}`}
        </p>
      )}
    </Panel>
  );
};

const EventRow: React.FC<{ event: ConnectionEvent; now: number }> = ({ event, now }) => {
  if (event.type === 'session_started') {
    return (
      <li className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
        <span className="flex-1 h-px bg-line" />
        <span>
          {CONNECTION_EVENT_LABELS.session_started} {formatEventTime(event.t, now)}
        </span>
        <span className="flex-1 h-px bg-line" />
      </li>
    );
  }
  return (
    <li className="px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs tabular-nums text-slate-400">{formatEventTime(event.t, now)}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[event.severity]}`}>
          {CONNECTION_EVENT_LABELS[event.type]}
        </span>
        {event.count > 1 && (
          <span className="text-xs text-slate-400">
            x{event.count}, last {formatEventTime(event.lastT, now)}
          </span>
        )}
        {event.restored && <span className="text-xs text-slate-400">earlier session</span>}
      </div>
      <div className={`${SEVERITY_TEXT[event.severity]} break-words leading-snug mt-1`}>{event.message}</div>
    </li>
  );
};
