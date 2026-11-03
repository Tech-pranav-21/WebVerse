/**
 * Validation of the pose service's JSON.
 *
 * The dashboard never trusts the shape of a response: a service that is an older version, a proxy that
 * answers with an HTML error page, or a half-written reply must produce a clear error, not a blank panel
 * or a crash inside a component. Pose data that is malformed throws PoseClientError('invalid_response').
 * Activity data is an add-on: if it is malformed, the pose result is kept and only the activity is dropped.
 */

import {
  ACTIVITY_LABELS,
  DETECTION_QUALITIES,
  TRACKING_STATUSES,
  VISIBILITY_MODES,
  type ActivityLabel,
  type ActivityRecognitionInfo,
  type LostTrack,
  type PoseActivity,
  type PoseBoundingBox,
  type PoseDetectionResult,
  type PoseKeypoint,
  type PosePerson,
} from '../types/pose';
import { PoseClientError } from './poseErrors';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function invalid(what: string): never {
  throw new PoseClientError(
    'invalid_response',
    `The pose service returned an unexpected response (${what}). Is the service up to date?`,
  );
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function parseKeypoint(v: unknown, where: string): PoseKeypoint {
  if (
    !isObject(v) ||
    !isNum(v.id) ||
    typeof v.name !== 'string' ||
    !isNum(v.x) ||
    !isNum(v.y) ||
    !isNum(v.confidence) ||
    typeof v.visible !== 'boolean'
  ) {
    invalid(`${where}: malformed keypoint`);
  }
  return { id: v.id, name: v.name, x: v.x, y: v.y, confidence: v.confidence, visible: v.visible };
}

function parseBox(v: unknown, where: string): PoseBoundingBox {
  if (!isObject(v) || !['x1', 'y1', 'x2', 'y2', 'width', 'height'].every((k) => isNum(v[k]))) {
    invalid(`${where}: malformed bounding box`);
  }
  return {
    x1: v.x1 as number,
    y1: v.y1 as number,
    x2: v.x2 as number,
    y2: v.y2 as number,
    width: v.width as number,
    height: v.height as number,
  };
}

/** Returns the activity, or null when it is absent or malformed (the caller decides how to tell the user). */
export function parseActivity(v: unknown): PoseActivity | null {
  if (!isObject(v)) return null;
  const nullableNum = (x: unknown) => x === null || isNum(x);
  const nullableLabel = (x: unknown) => x === null || oneOf(ACTIVITY_LABELS, x);
  if (
    !oneOf(ACTIVITY_LABELS, v.label) ||
    !oneOf(ACTIVITY_LABELS, v.candidate_label) ||
    !nullableLabel(v.previous_label) ||
    !nullableNum(v.confidence) ||
    !nullableNum(v.track_id) ||
    !nullableNum(v.inactive_s) ||
    typeof v.confirmed !== 'boolean' ||
    !isNum(v.duration_s) ||
    !isNum(v.body_visibility) ||
    !isNum(v.quality_score) ||
    !isNum(v.observations) ||
    !oneOf(VISIBILITY_MODES, v.visibility_mode) ||
    !oneOf(DETECTION_QUALITIES, v.detection_quality) ||
    !oneOf(TRACKING_STATUSES, v.tracking_status)
  ) {
    return null;
  }
  return {
    track_id: v.track_id as number | null,
    label: v.label as ActivityLabel,
    confidence: v.confidence as number | null,
    confirmed: v.confirmed,
    candidate_label: v.candidate_label as ActivityLabel,
    previous_label: v.previous_label as ActivityLabel | null,
    duration_s: v.duration_s,
    body_visibility: v.body_visibility,
    visibility_mode: v.visibility_mode,
    detection_quality: v.detection_quality,
    quality_score: v.quality_score,
    tracking_status: v.tracking_status,
    observations: v.observations,
    inactive_s: v.inactive_s as number | null,
    note: typeof v.note === 'string' ? v.note : null,
    missing_regions: Array.isArray(v.missing_regions) ? v.missing_regions.filter((r): r is string => typeof r === 'string') : [],
    evidence: isObject(v.evidence) ? v.evidence : {},
  };
}

function parseLostTracks(v: unknown): LostTrack[] {
  if (!Array.isArray(v)) return [];
  const out: LostTrack[] = [];
  for (const t of v) {
    if (isObject(t) && isNum(t.track_id) && isNum(t.seconds_since_seen)) {
      out.push({
        track_id: t.track_id,
        last_label: oneOf(ACTIVITY_LABELS, t.last_label) ? t.last_label : null,
        seconds_since_seen: t.seconds_since_seen,
      });
    }
  }
  return out;
}

function parseActivityInfo(v: unknown): ActivityRecognitionInfo | undefined {
  if (!isObject(v) || typeof v.enabled !== 'boolean') return undefined;
  const info: ActivityRecognitionInfo = { enabled: v.enabled };
  if (typeof v.tracking === 'boolean') info.tracking = v.tracking;
  if (typeof v.session_id === 'string') info.session_id = v.session_id;
  if (isNum(v.persons_analyzed)) info.persons_analyzed = v.persons_analyzed;
  if (isNum(v.persons_skipped)) info.persons_skipped = v.persons_skipped;
  if (Array.isArray(v.lost_tracks)) info.lost_tracks = parseLostTracks(v.lost_tracks);
  if (typeof v.error === 'string') info.error = v.error;
  return info;
}

/** Validate a /detect response. Throws PoseClientError('invalid_response') when the pose data is unusable. */
export function parsePoseDetectionResult(raw: unknown): PoseDetectionResult {
  if (!isObject(raw)) invalid('not a JSON object');
  if (!Array.isArray(raw.persons)) invalid('"persons" is missing');
  if (!isNum(raw.inference_time_ms)) invalid('"inference_time_ms" is missing');
  if (typeof raw.device !== 'string') invalid('"device" is missing');

  let droppedActivities = 0;
  const persons: PosePerson[] = raw.persons.map((p, i) => {
    if (!isObject(p) || !Array.isArray(p.keypoints)) invalid(`person ${i}: no keypoints`);
    const person: PosePerson = {
      person_id: isNum(p.person_id) ? p.person_id : i,
      bbox: parseBox(p.bbox, `person ${i}`),
      bbox_confidence: isNum(p.bbox_confidence) ? p.bbox_confidence : 0,
      keypoints: p.keypoints.map((k) => parseKeypoint(k, `person ${i}`)),
      visible_keypoints: isNum(p.visible_keypoints) ? p.visible_keypoints : 0,
      total_keypoints: isNum(p.total_keypoints) ? p.total_keypoints : p.keypoints.length,
    };
    if (isNum(p.track_id)) person.track_id = p.track_id;
    if (p.activity !== undefined && p.activity !== null) {
      const activity = parseActivity(p.activity);
      if (activity) person.activity = activity;
      else droppedActivities += 1;
    }
    return person;
  });

  const result: PoseDetectionResult = {
    ok: raw.ok !== false,
    person_count: isNum(raw.person_count) ? raw.person_count : persons.length,
    persons,
    image_width: isNum(raw.image_width) ? raw.image_width : 0,
    image_height: isNum(raw.image_height) ? raw.image_height : 0,
    inference_time_ms: raw.inference_time_ms,
    total_time_ms: isNum(raw.total_time_ms) ? raw.total_time_ms : raw.inference_time_ms,
    device: raw.device,
    model: typeof raw.model === 'string' ? raw.model : 'unknown',
  };
  const info = parseActivityInfo(raw.activity_recognition);
  if (info) result.activity_recognition = info;
  if (droppedActivities > 0) {
    result.activity_recognition = {
      ...(result.activity_recognition ?? { enabled: true }),
      error: result.activity_recognition?.error ?? 'The activity data in the service response was not understood.',
    };
  }
  if (typeof raw.annotated_image_base64 === 'string' && raw.annotated_image_base64.length > 0) {
    result.annotated_image_base64 = raw.annotated_image_base64;
  }
  return result;
}
