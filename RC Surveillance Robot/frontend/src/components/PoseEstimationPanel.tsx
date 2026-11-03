/**
 * PoseEstimationPanel
 * Interactive test interface for the Local Human Pose Detection Service.
 * Captures frames safely from the existing camera feed without opening a second stream.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Info,
  Loader2,
  Maximize2,
  RefreshCw,
  Sliders,
  Sparkles,
  Upload,
  UserCheck,
  Video,
  Zap,
} from 'lucide-react';
import type { CameraConfig, StreamHealth, SurveillanceViewMode } from '../types/camera';
import type { PoseDetectionResult, PoseServiceHealth } from '../types/pose';
import { poseClient } from '../services/poseClient';
import { captureFrameFromImage, isCaptureFailure } from '../services/frameCapture';
import { INFERENCE_OPTIONS, createSessionId, sampleSessionId } from '../services/poseSettings';
import { ActionButton, BTN_PRIMARY, BTN_SECONDARY, Notice, Panel, StatusBadge } from './ui';
import { ActivityRecognitionSection } from './ActivityRecognitionSection';
import { PoseKeypointInspector } from './PoseKeypointInspector';

export interface PoseEstimationPanelProps {
  feedSlot?: React.ReactNode;
  viewMode: SurveillanceViewMode;
  isStreamConfigured: boolean;
  health: StreamHealth;
  getImage: () => HTMLImageElement | null;
  streamUrl: string;
  config: CameraConfig;
}

export const PoseEstimationPanel: React.FC<PoseEstimationPanelProps> = ({
  feedSlot,
  viewMode,
  isStreamConfigured,
  health,
  getImage,
  config,
}) => {
  const [serviceHealth, setServiceHealth] = useState<PoseServiceHealth | null>(null);
  const [checkingService, setCheckingService] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [lastResult, setLastResult] = useState<PoseDetectionResult | null>(null);
  const [annotatedImgUrl, setAnnotatedImgUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set only when the request to the service fails: the activity section explains why it has nothing to show.
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [autoIntervalSec, setAutoIntervalSec] = useState<number>(0); // 0 = manual
  const [selectedPersonIdx, setSelectedPersonIdx] = useState<number>(0);
  // One id per page visit: the service keeps one pose history per id, so this camera's frames form one video.
  const sessionIdRef = useRef<string>(createSessionId());
  // Never two analyses at once, whatever triggers them (button, timer, sample frame).
  const inFlightRef = useRef(false);

  // Poll service health on mount and periodically
  const checkHealth = useCallback(async () => {
    setCheckingService(true);
    try {
      const data = await poseClient.checkHealth();
      setServiceHealth(data);
      if (!data) {
        setErrorMessage(
          'Local pose service is offline. Start it by running: python activity-recognition/run_service.py'
        );
      } else {
        setErrorMessage(null);
      }
    } catch {
      setServiceHealth(null);
    } finally {
      setCheckingService(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Capture frame from existing image element (Zero extra ESP32-CAM stream connection!)
  const captureCurrentFrame = useCallback(async (): Promise<Blob | null> => {
    const img = getImage();
    if (!img) {
      setErrorMessage('No camera element found to capture a frame from.');
      return null;
    }
    const outcome = await captureFrameFromImage(img);
    if (isCaptureFailure(outcome)) {
      setErrorMessage(
        outcome.failure.kind === 'blocked'
          ? 'Browser canvas security restriction: enable "Allow snapshot capture" in Settings to read live stream pixels.'
          : outcome.failure.message
      );
      return null;
    }
    return outcome.frame.blob;
  }, [getImage]);

  // Main pose detection trigger. `isSample` frames (the synthetic test image) are analysed alone and never
  // become part of the live camera's tracking history.
  const runDetection = useCallback(
    async (sourceBlob?: Blob, isSample = false) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsDetecting(true);
      setErrorMessage(null);
      try {
        const blobToAnalyze = sourceBlob || (await captureCurrentFrame());
        if (!blobToAnalyze) {
          return;
        }

        // One request returns the keypoints, the activities AND the skeleton overlay (one inference).
        let result;
        try {
          result = await poseClient.detect(blobToAnalyze, {
            sessionId: isSample ? sampleSessionId(sessionIdRef.current) : sessionIdRef.current,
            trackActivity: !isSample,
            includeAnnotated: true,
          });
        } catch (err: any) {
          setDetectionError(err.message || 'Pose detection request failed.');
          throw err;
        }
        const { annotated_image_base64: overlay, ...data } = result;
        setLastResult(data);
        setDetectionError(null); // only a new successful result clears a failure: no stale activity flashes back

        if (overlay) {
          setAnnotatedImgUrl((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return `data:image/jpeg;base64,${overlay}`;
          });
        } else {
          // Older service without includeAnnotated: fall back to the separate (stateless) overlay request.
          try {
            const visual = await poseClient.detectAnnotated(blobToAnalyze);
            const objUrl = URL.createObjectURL(visual.blob);
            setAnnotatedImgUrl((prev) => {
              if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
              return objUrl;
            });
          } catch (visErr) {
            console.warn('Visual skeleton overlay failed:', visErr);
          }
        }
      } catch (err: any) {
        setErrorMessage(err.message || 'Pose detection request failed.');
      } finally {
        inFlightRef.current = false;
        setIsDetecting(false);
      }
    },
    [captureCurrentFrame]
  );

  // Auto-detection loop if continuous mode selected
  useEffect(() => {
    if (autoIntervalSec <= 0 || !serviceHealth?.ok) return;
    const ms = autoIntervalSec * 1000;
    const timer = setInterval(() => {
      if (!isDetecting) {
        void runDetection();
      }
    }, ms);
    return () => clearInterval(timer);
  }, [autoIntervalSec, isDetecting, runDetection, serviceHealth?.ok]);

  // Release the overlay when the page closes. Only a blob: URL holds memory; the overlay is normally a
  // data: URL now (it arrives inside the detection response), and those must not be passed to revoke.
  useEffect(() => {
    return () => {
      if (annotatedImgUrl && annotatedImgUrl.startsWith('blob:')) URL.revokeObjectURL(annotatedImgUrl);
    };
  }, [annotatedImgUrl]);

  // Generate synthetic test image for verification without physical hardware
  const handleTestSampleImage = useCallback(async () => {
    setIsDetecting(true);
    setErrorMessage(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create test canvas');

      // Light background
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 640, 480);

      // Draw stylized human figure
      const cx = 320;
      const cy = 240;

      // Head
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(cx, cy - 130, 28, 0, Math.PI * 2);
      ctx.fill();

      // Torso
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx - 35, cy - 95, 70, 130);

      // Arms
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 30, cy - 80);
      ctx.lineTo(cx - 75, cy - 10);
      ctx.lineTo(cx - 85, cy + 50);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + 30, cy - 80);
      ctx.lineTo(cx + 75, cy - 10);
      ctx.lineTo(cx + 85, cy + 50);
      ctx.stroke();

      // Legs
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(cx - 20, cy + 35);
      ctx.lineTo(cx - 30, cy + 120);
      ctx.lineTo(cx - 35, cy + 190);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + 20, cy + 35);
      ctx.lineTo(cx + 30, cy + 120);
      ctx.lineTo(cx + 35, cy + 190);
      ctx.stroke();

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92));
      await runDetection(blob, true);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed generating sample test frame.');
    } finally {
      setIsDetecting(false);
    }
  }, [runDetection]);

  const serviceOnline = Boolean(serviceHealth?.ok);
  const hardwareDevice = serviceHealth?.hardware.device || 'unknown';
  const isCuda = hardwareDevice.startsWith('cuda');

  return (
    <Panel
      id="local-pose"
      title="Local Human Pose Estimation"
      icon={Activity}
      description="Real-time on-device human detection and 17-point body keypoint estimation. Runs locally with zero cloud API dependency."
      status={
        <div className="flex items-center gap-2">
          {checkingService ? (
            <StatusBadge tone="neutral" busy={true}>
              Checking...
            </StatusBadge>
          ) : serviceOnline ? (
            <StatusBadge tone="good">
              {isCuda ? `RTX 2050 (GPU)` : `CPU Fallback`}
            </StatusBadge>
          ) : (
            <StatusBadge tone="bad">Service Offline</StatusBadge>
          )}
        </div>
      }
    >
      {/* Service Status & Quick Guidance */}
      {!serviceOnline && (
        <Notice tone="warn" role="alert">
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">Local Pose Estimation Service is not responding</p>
            <p className="text-xs text-amber-300/90 leading-relaxed">
              Start the Python service in your terminal:
            </p>
            <pre className="text-xs bg-black/60 p-2 rounded font-mono text-cyan-300 select-all">
              python activity-recognition/run_service.py
            </pre>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => void checkHealth()}
                disabled={checkingService}
                className={`${BTN_SECONDARY} !h-7 !text-xs`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingService ? 'animate-spin' : ''}`} />
                <span>Retry Connection</span>
              </button>
            </div>
          </div>
        </Notice>
      )}

      {errorMessage && (
        <Notice tone="bad" role="alert">
          <p className="text-xs">{errorMessage}</p>
        </Notice>
      )}

      {/* Main Grid: Left = Live Camera, Right = Pose Preview & Keypoints */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Live Camera Feed and Capture Actions */}
        <div className="lg:col-span-6 space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Video className="w-4 h-4 text-cyan-400" />
              Live Camera Feed
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {health.status === 'connected' ? 'Connected (Zero extra stream)' : health.status}
            </span>
          </div>

          {/* Video Feed Box Slot */}
          <div className="w-full rounded-xl overflow-hidden border border-line bg-black shadow-[0_0_30px_-12px_rgba(30,140,255,0.4)]">
            {feedSlot}
          </div>

          {/* Action Triggers */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runDetection()}
                disabled={isDetecting || !serviceOnline}
                className={`${BTN_PRIMARY} !h-10 text-xs font-semibold`}
                title="Capture one frame and run local pose estimation"
              >
                {isDetecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 text-cyan-300" />
                )}
                <span>{isDetecting ? 'Estimating...' : 'Analyze Current Frame'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleTestSampleImage()}
                disabled={isDetecting || !serviceOnline}
                className={`${BTN_SECONDARY} !h-10 text-xs font-medium`}
                title="Run estimation on a synthetic human test frame"
              >
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Test Sample Frame</span>
              </button>
            </div>

            {/* Inference Rate Controls */}
            <div className="p-3 rounded-lg bg-sunken border border-line flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>Inference Frequency:</span>
              </div>
              <div className="flex items-center gap-1.5">
                {INFERENCE_OPTIONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setAutoIntervalSec(item.intervalSec)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                      autoIntervalSec === item.intervalSec
                        ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-400/50 font-semibold'
                        : 'bg-raised hover:bg-slate-800 text-slate-300 border border-line'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Visual Skeleton Overlay & Keypoint Inspector */}
        <div className="lg:col-span-6 space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              Pose Estimation Preview
            </span>
            {lastResult && (
              <span className="text-[11px] font-mono text-cyan-300">
                {lastResult.inference_time_ms} ms • {lastResult.device}
              </span>
            )}
          </div>

          {/* Skeleton Overlay Preview Display */}
          <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-line bg-slate-950 flex items-center justify-center">
            {annotatedImgUrl ? (
              <img
                src={annotatedImgUrl}
                alt="Pose Estimation Result"
                className="w-full h-full object-contain"
              />
            ) : isDetecting ? (
              <div className="flex flex-col items-center justify-center space-y-2 text-slate-400 text-xs">
                <Loader2 className="w-7 h-7 animate-spin text-cyan-400" />
                <span>Running local YOLO pose model...</span>
              </div>
            ) : (
              <div className="text-center p-6 space-y-2 text-slate-400 text-xs max-w-sm">
                <Activity className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="font-medium text-slate-300">No pose analysis run yet</p>
                <p className="text-slate-400 text-[12px]">
                  Click "Analyze Current Frame" or "Test Sample Frame" to detect people and body keypoints.
                </p>
              </div>
            )}

            {lastResult && (
              <div className="absolute top-2.5 left-2.5 bg-black/75 backdrop-blur-sm px-2.5 py-1 rounded text-xs font-mono text-slate-200 border border-white/10 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Persons: {lastResult.person_count}</span>
              </div>
            )}
          </div>

          {/* Metrics summary card */}
          {lastResult && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-lg bg-sunken border border-line">
                <div className="text-slate-400 text-[11px]">Detected People</div>
                <div className="text-lg font-bold text-white font-mono">{lastResult.person_count}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-sunken border border-line">
                <div className="text-slate-400 text-[11px]">Inference Latency</div>
                <div className="text-lg font-bold text-cyan-300 font-mono">{lastResult.inference_time_ms} ms</div>
              </div>
              <div className="p-2.5 rounded-lg bg-sunken border border-line">
                <div className="text-slate-400 text-[11px]">Hardware Device</div>
                <div className="text-sm font-bold text-emerald-400 font-mono uppercase truncate pt-1">
                  {lastResult.device}
                </div>
              </div>
            </div>
          )}

          {/* Detected Persons & Keypoints Breakdown */}
          {lastResult && (
            <PoseKeypointInspector result={lastResult} selectedIdx={selectedPersonIdx} onSelect={setSelectedPersonIdx} />
          )}
        </div>
      </div>

      {/* Human Activity Recognition: what each detected person is doing (all values come from the service) */}
      <ActivityRecognitionSection result={lastResult} isDetecting={isDetecting} error={detectionError} />
    </Panel>
  );
};
