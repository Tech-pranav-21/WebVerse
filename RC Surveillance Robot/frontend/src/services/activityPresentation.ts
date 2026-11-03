/**
 * How a recognised activity is shown. Pure functions: every number and word on screen comes from the
 * service's actual response, these only format it. Nothing here invents a value.
 */

import type {
  ActivityLabel,
  DetectionQuality,
  LostTrack,
  PoseActivity,
  PoseDetectionResult,
  PosePerson,
  TrackingStatus,
  VisibilityMode,
} from '../types/pose';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

export const QUALITY_TEXT: Record<DetectionQuality, string> = {
  good: 'Good',
  medium: 'Medium',
  poor: 'Poor',
  insufficient: 'Insufficient',
};

export const QUALITY_TONE: Record<DetectionQuality, Tone> = {
  good: 'good',
  medium: 'accent',
  poor: 'warn',
  insufficient: 'bad',
};

export const MODE_TEXT: Record<VisibilityMode, string> = {
  full_body: 'Full body',
  upper_body: 'Upper body',
  partial: 'Partial body',
  insufficient: 'Insufficient',
};

export const TRACKING_TEXT: Record<TrackingStatus, string> = {
  untracked: 'Single frame',
  initializing: 'Initializing',
  tracking: 'Tracking',
  reacquired: 'Reacquired',
};

export const TRACKING_TONE: Record<TrackingStatus, Tone> = {
  untracked: 'neutral',
  initializing: 'warn',
  tracking: 'good',
  reacquired: 'accent',
};

/** 0.923 -> "92%". Null (nothing classified) -> an em dash, never a number. */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

/** 12 -> "12 s", 65 -> "1 min 5 s", 3725 -> "1 h 2 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${m} min ${rest} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Colour of the activity itself. Lying and long inactivity deserve attention; "no activity" states are muted. */
export function activityTone(a: Pick<PoseActivity, 'label' | 'confirmed'>): Tone {
  const label: ActivityLabel = a.label;
  switch (label) {
    case 'Lying Down':
    case 'Prolonged Inactivity':
    case 'Possible Sleeping':
    case 'Partial Body Detected':
      return 'warn';
    case 'Insufficient Visibility':
      return 'bad';
    case 'Unknown Activity':
      return 'neutral';
    default:
      return a.confirmed ? 'accent' : 'neutral';
  }
}

/** Labels that mean "nothing is claimed about what the person is doing". */
export function isNoActivityLabel(label: ActivityLabel): boolean {
  return label === 'Partial Body Detected' || label === 'Insufficient Visibility' || label === 'Unknown Activity';
}

export interface PersonActivityView {
  key: string;
  /** "Person #1": the stable tracking id when there is one, otherwise the detection index. */
  title: string;
  activity: string;
  /** "Confirmed" | "Provisional" | "Not classified" */
  stateText: string;
  stateTone: Tone;
  tone: Tone;
  confidenceText: string;
  confidencePct: number | null;
  visibilityText: string;
  visibilityPct: number;
  qualityText: string;
  qualityTone: Tone;
  modeText: string;
  durationText: string;
  previousText: string;
  trackingText: string;
  trackingTone: Tone;
  note: string | null;
  missingRegions: string[];
  inactiveText: string | null;
  observations: number;
}

/**
 * The identifier shown for a person, shared by the activity cards and the keypoint inspector: the stable
 * tracking id when there is one, otherwise the position in this frame (counted from 1).
 */
export function personTitle(person: Pick<PosePerson, 'track_id'>, index: number): string {
  return `Person #${person.track_id ?? index + 1}`;
}

/** Everything the card of one person shows, or null if the service gave this person no activity. */
export function buildPersonView(person: PosePerson, index: number): PersonActivityView | null {
  const a = person.activity;
  if (!a) return null;
  const noActivity = isNoActivityLabel(a.label);
  const stateText = noActivity ? 'Not classified' : a.confirmed ? 'Confirmed' : 'Provisional';
  const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
  return {
    key: `track-${a.track_id ?? `idx-${index}`}`,
    title: personTitle(person, index),
    activity: a.label,
    stateText,
    stateTone: noActivity ? 'neutral' : a.confirmed ? 'good' : 'warn',
    tone: activityTone(a),
    confidenceText: formatPercent(a.confidence),
    confidencePct: a.confidence === null ? null : pct(a.confidence),
    visibilityText: formatPercent(a.body_visibility),
    visibilityPct: pct(a.body_visibility),
    qualityText: QUALITY_TEXT[a.detection_quality],
    qualityTone: QUALITY_TONE[a.detection_quality],
    modeText: MODE_TEXT[a.visibility_mode],
    durationText: formatDuration(a.duration_s),
    previousText: a.previous_label ?? 'None',
    trackingText: TRACKING_TEXT[a.tracking_status],
    trackingTone: TRACKING_TONE[a.tracking_status],
    note: a.note,
    missingRegions: a.missing_regions,
    inactiveText: a.inactive_s !== null && a.inactive_s > 0 ? formatDuration(a.inactive_s) : null,
    observations: a.observations,
  };
}

export function lostTrackText(t: LostTrack): string {
  const when = formatDuration(t.seconds_since_seen);
  return t.last_label
    ? `Person #${t.track_id} left the view ${when} ago (last seen: ${t.last_label}).`
    : `Person #${t.track_id} left the view ${when} ago.`;
}

export type ActivityEmptyState =
  | { kind: 'idle' }
  | { kind: 'no_person' }
  | { kind: 'disabled' }
  | { kind: 'unavailable'; message: string };

/**
 * Why there is no activity card to show, or null when there is at least one. The text a user sees for
 * each case is in ActivityRecognitionSection; this decides which case it is.
 */
export function describeEmptyState(result: PoseDetectionResult | null): ActivityEmptyState | null {
  if (!result) return { kind: 'idle' };
  if (result.persons.length === 0) return { kind: 'no_person' };
  if (result.persons.some((p) => p.activity)) return null;
  const info = result.activity_recognition;
  if (info?.enabled === false) return { kind: 'disabled' };
  return {
    kind: 'unavailable',
    message: info?.error ?? 'The service returned no activity information for the detected people.',
  };
}
