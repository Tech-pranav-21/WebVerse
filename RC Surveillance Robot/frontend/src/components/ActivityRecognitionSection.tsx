/**
 * ActivityRecognitionSection
 * "HUMAN ACTIVITY RECOGNITION" on the Pose Estimation page: what each person in the last analysed frame is
 * doing, how sure the service is, and how much of the body it could see. Presentation only: every value
 * comes from the service's response (see services/activityPresentation.ts).
 */

import React from 'react';
import { Info, Loader2, PersonStanding, UserSearch } from 'lucide-react';
import type { PoseDetectionResult } from '../types/pose';
import {
  buildPersonView,
  describeEmptyState,
  lostTrackText,
  type PersonActivityView,
  type Tone,
} from '../services/activityPresentation';
import { Notice, StatusBadge } from './ui';

export interface ActivityRecognitionSectionProps {
  /** The last pose result, or null before the first analysis. */
  result: PoseDetectionResult | null;
  isDetecting: boolean;
  /** Set when the last request to the service failed, so no activity could be produced. */
  error?: string | null;
}

const BAR_TONE: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  good: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
  accent: 'bg-cyan-400',
};

const ACTIVITY_TEXT_TONE: Record<Tone, string> = {
  neutral: 'text-slate-200',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  accent: 'text-cyan-300',
};

const Meter: React.FC<{ pct: number; tone: Tone; label: string }> = ({ pct, tone, label }) => (
  <div
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={pct}
    className="h-1.5 w-full rounded-full bg-raised overflow-hidden"
  >
    <div className={`h-full rounded-full ${BAR_TONE[tone]}`} style={{ width: `${pct}%` }} />
  </div>
);

const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className = '', children }) => (
  <div className={`min-w-0 ${className}`}>
    <dt className="text-[11px] text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-slate-100">{children}</dd>
  </div>
);

const PersonCard: React.FC<{ view: PersonActivityView }> = ({ view }) => (
  <article
    aria-label={`${view.title} activity`}
    data-testid="activity-card"
    className="p-3.5 rounded-xl bg-sunken border border-line space-y-3"
  >
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
      <Field label="Detected Person">
        <span className="font-semibold text-white">{view.title}</span>
        <span className="ml-2 text-[11px] text-slate-400">{view.modeText}</span>
      </Field>
      <Field label="Tracking Status">
        <StatusBadge tone={view.trackingTone}>{view.trackingText}</StatusBadge>
      </Field>

      <Field label="Current Activity" className="col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-lg font-bold leading-tight ${ACTIVITY_TEXT_TONE[view.tone]}`}>{view.activity}</span>
          <StatusBadge tone={view.stateTone}>{view.stateText}</StatusBadge>
        </div>
      </Field>

      <Field label="Activity Confidence">
        <div className="font-mono text-sm font-semibold">{view.confidenceText}</div>
        {view.confidencePct === null ? (
          <div className="text-[11px] text-slate-500">Not available</div>
        ) : (
          <Meter pct={view.confidencePct} tone="accent" label="Activity confidence" />
        )}
      </Field>
      <Field label="Body Visibility">
        <div className="font-mono text-sm font-semibold">{view.visibilityText}</div>
        <Meter pct={view.visibilityPct} tone={view.qualityTone} label="Body visibility" />
      </Field>

      <Field label="Detection Quality">
        <StatusBadge tone={view.qualityTone}>{view.qualityText}</StatusBadge>
      </Field>
      <Field label="Activity Duration">
        <span className="font-mono">{view.durationText}</span>
      </Field>

      <Field label="Previous Activity" className="col-span-2">
        {view.previousText}
      </Field>
    </dl>

    {view.inactiveText && (
      <p className="text-[11px] text-amber-300/90">No movement for {view.inactiveText}.</p>
    )}
    {view.missingRegions.length > 0 && (
      <p className="text-[11px] text-slate-400">Not clearly visible: {view.missingRegions.join(', ')}.</p>
    )}
    {view.note && (
      <p className="flex gap-1.5 text-[11px] leading-relaxed text-slate-400">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px text-cyan-500" aria-hidden="true" />
        <span>{view.note}</span>
      </p>
    )}
  </article>
);

export const ActivityRecognitionSection: React.FC<ActivityRecognitionSectionProps> = ({ result, isDetecting, error }) => {
  // After a failed analysis the previous result is out of date. It is not shown as if it were current.
  const current = error ? null : result;
  const empty = describeEmptyState(current);
  const views: PersonActivityView[] = [];
  let notAnalysed = 0;
  current?.persons.forEach((person, i) => {
    const view = buildPersonView(person, i);
    if (view) views.push(view);
    else notAnalysed += 1;
  });
  const info = current?.activity_recognition;
  const lost = info?.lost_tracks ?? [];

  return (
    <section aria-labelledby="activity-recognition-title" data-testid="activity-recognition" className="space-y-3 pt-5 border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="activity-recognition-title"
          className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5"
        >
          <PersonStanding className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          HUMAN ACTIVITY RECOGNITION
        </h3>
        {isDetecting && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400" role="status">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            Analysing…
          </span>
        )}
      </div>

      {error && (
        <Notice tone="bad" role="status">
          <p className="text-xs">Activity recognition could not run: {error}</p>
          {result && result.persons.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-400">The last result is hidden because it is out of date.</p>
          )}
        </Notice>
      )}

      {!error && empty?.kind === 'idle' && (
        <p className="text-xs text-slate-400">
          Run an analysis to see what each person in the frame is doing. Walking and running are judged over
          several frames, so use one of the automatic inference modes for them.
        </p>
      )}
      {!error && empty?.kind === 'no_person' && <p className="text-xs text-slate-300">No person detected in the last frame.</p>}
      {!error && empty?.kind === 'disabled' && (
        <p className="text-xs text-slate-400">Activity recognition is switched off on the local service (HAR_ENABLED).</p>
      )}
      {!error && empty?.kind === 'unavailable' && (
        <Notice tone="warn" role="status">
          <p className="text-xs">Activity recognition is unavailable for this frame: {empty.message}</p>
        </Notice>
      )}

      {!error && info?.error && !empty?.kind && (
        <Notice tone="warn" role="status">
          <p className="text-xs">{info.error}</p>
        </Notice>
      )}

      {views.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {views.map((v) => (
            <PersonCard key={v.key} view={v} />
          ))}
        </div>
      )}

      {notAnalysed > 0 && views.length > 0 && (
        <p className="text-[11px] text-slate-500">
          {notAnalysed} more {notAnalysed === 1 ? 'person was' : 'people were'} detected but not analysed (only the largest people are).
        </p>
      )}

      {lost.length > 0 && (
        <ul className="space-y-1" aria-label="People who left the view">
          {lost.map((t) => (
            <li key={t.track_id} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <UserSearch className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              {lostTrackText(t)}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Activities are estimates from body posture and movement, not facts; confidence is a heuristic score, not a
        probability. Nothing is classified when too little of the body is visible.
      </p>
    </section>
  );
};
