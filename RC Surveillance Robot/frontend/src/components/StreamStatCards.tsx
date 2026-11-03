/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Clock, HardDrive, Video, Wifi, WifiOff } from 'lucide-react';
import type { SnapshotItem, StreamHealth, SurveillanceViewMode } from '../types/camera';
import { useNow } from '../hooks/useNow';
import { describeStatus, formatAgo } from '../services/streamStatusText';
import { formatRequestTime } from '../services/diagnosticsSummary';
import { StatCard, StatTone } from './ui';

interface StreamStatCardsProps {
  health: StreamHealth;
  viewMode: SurveillanceViewMode;
  snapshots: SnapshotItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Four numbers under the picture. Each one is read from the live connection, the camera-host
 * measurements or the snapshot gallery; when something cannot be known (for example the frame rate
 * with a plain video element) the card says so instead of showing a number.
 */
export const StreamStatCards: React.FC<StreamStatCardsProps> = ({ health, viewMode, snapshots }) => {
  const now = useNow(true, 1000);
  const status = health.status;
  const connected = status === 'connected';

  // Connection card: the stream state, and the time the camera's web server last took to answer a request.
  const lastSample = health.hostSamples[health.hostSamples.length - 1];
  const connectionTone: StatTone = connected ? 'good' : status === 'reconnecting' ? 'warn' : status === 'error' ? 'bad' : 'neutral';
  const connectionLabel: Record<string, string> = {
    connected: 'Connected',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    error: 'Connection error',
    host_reachable: 'Host online',
    unconfigured: 'Not configured',
    disconnected: viewMode === 'snapshot' ? 'Snapshot mode' : 'Not streaming',
  };
  const requestTime = lastSample
    ? lastSample.ok
      ? `${formatRequestTime(lastSample.elapsedMs)} camera response`
      : lastSample.failure === 'timeout'
        ? 'Camera response timed out'
        : 'Camera did not answer'
    : 'Response time not measured yet';

  // Stream card: only claims frames when the page can actually see them.
  let streamValue = 'No stream';
  let streamDetail: string = describeStatus(health);
  if (connected && health.evidence === 'frames' && health.frameStats) {
    streamValue = 'Receiving frames';
    streamDetail = `${health.frameStats.fps5s} FPS over the last 5 s`;
  } else if (connected) {
    streamValue = 'First frame received';
    streamDetail = 'Frame rate needs Frame monitor (Settings)';
  } else if (status === 'connecting' || status === 'reconnecting') {
    streamValue = status === 'connecting' ? 'Connecting' : 'Reconnecting';
  } else if (viewMode === 'snapshot') {
    streamValue = 'Snapshot mode';
    streamDetail = 'The live stream is closed on purpose.';
  }

  // Last frame card: "last frame" with Frame monitor, otherwise the first frame of this connection.
  const frameLabel = health.evidence === 'frames' ? 'Last frame' : 'Stream opened';
  const frameValue = connected && health.lastFrameAt != null ? formatAgo(health.lastFrameAt, now) : 'No frame yet';

  const last24h = snapshots.filter((s) => now - s.timestamp <= DAY_MS).length;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={connected ? Wifi : WifiOff}
        tone={connectionTone}
        label="Connection"
        value={connectionLabel[status] ?? status}
        detail={requestTime}
      />
      <StatCard icon={Video} tone="violet" label="Stream Status" value={streamValue} detail={streamDetail} />
      <StatCard
        icon={Clock}
        tone="blue"
        label={frameLabel}
        value={frameValue}
        detail={connected ? 'JPEG frames (MJPEG stream)' : undefined}
      />
      <StatCard
        icon={HardDrive}
        tone="amber"
        label="Snapshots"
        value={`${snapshots.length} saved`}
        detail={`${last24h} in the last 24 h`}
      />
    </div>
  );
};
