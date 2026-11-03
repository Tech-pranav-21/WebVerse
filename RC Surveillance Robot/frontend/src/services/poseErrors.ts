/**
 * Errors of the local pose service client. Every message is written for the person using the dashboard.
 */

export type PoseClientErrorKind =
  /** The service could not be reached at all (not running, wrong port). */
  | 'unreachable'
  /** The service did not answer in time. */
  | 'timeout'
  /** The caller cancelled the request. */
  | 'cancelled'
  /** The service answered, but not with a pose result the dashboard understands. */
  | 'invalid_response'
  /** HTTP 503: the pose model failed to load on the service. */
  | 'model_unavailable'
  /** HTTP 4xx: the frame was rejected (unreadable, too large, ...). */
  | 'bad_request'
  /** HTTP 5xx: the service failed while processing the frame. */
  | 'server_error';

export class PoseClientError extends Error {
  readonly kind: PoseClientErrorKind;
  readonly status?: number;

  constructor(kind: PoseClientErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'PoseClientError';
    this.kind = kind;
    this.status = status;
  }
}

export function isPoseClientError(err: unknown): err is PoseClientError {
  return err instanceof PoseClientError;
}
