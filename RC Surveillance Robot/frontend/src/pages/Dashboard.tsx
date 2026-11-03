/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ListChecks, ScanSearch } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { EventHistoryView, EventFilter } from '../components/EventHistoryView';
import { CameraView, CameraFeedBox } from '../components/CameraView';
import { CameraStatus } from '../components/CameraStatus';
import { StreamStatCards } from '../components/StreamStatCards';
import { MotionDetectionPanel } from '../components/MotionDetectionPanel';
import { AiRecognitionPanel } from '../components/AiRecognitionPanel';
import { PoseEstimationPanel } from '../components/PoseEstimationPanel';
import { MotionEventBus } from '../services/motionEventBus';
import { SettingsPage } from '../components/SettingsPage';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { SnapshotGallery } from '../components/SnapshotGallery';
import { NetworkGuideView } from '../components/NetworkGuideView';
import { cameraService } from '../services/cameraService';
import { isMixedContentRestricted } from '../services/connectionService';
import { describeStatus } from '../services/streamStatusText';
import { useStreamConnection } from '../hooks/useStreamConnection';
import { useSmartSnapshot } from '../hooks/useSmartSnapshot';
import { BTN_SECONDARY, BadgeTone, StatusBadge } from '../components/ui';
import {
  CameraConfig,
  ActiveNavTab,
  SurveillanceViewMode,
} from '../types/camera';

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveNavTab>('feed');
  const [config, setConfig] = useState<CameraConfig>(() =>
    cameraService.getConfig()
  );
  const [lastConnectionTime, setLastConnectionTime] = useState<number | null>(
    () => cameraService.getLastConnectionTime()
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<SurveillanceViewMode>('stream');
  // Which events the Event History page opens with ("View All" on the motion and AI cards sets it).
  const [eventsFilter, setEventsFilter] = useState<EventFilter>('all');
  // Set by the Dashboard's "AI Analyze": AI Detection runs one analysis (if AI is switched on) and clears it.
  const [aiAnalyzePending, setAiAnalyzePending] = useState(false);
  // Accurate AI service status badge for the AI Detection page header
  const [aiBadge, setAiBadge] = useState<{ label: string; tone: BadgeTone; busy?: boolean }>({
    label: 'Off',
    tone: 'neutral',
  });

  // Persistent camera feed node and slots across page navigation
  const persistentFeedHolderRef = useRef<HTMLDivElement>(null);
  const persistentFeedNodeRef = useRef<HTMLDivElement>(null);
  const feedSlotRef = useRef<HTMLDivElement>(null);
  const aiSlotRef = useRef<HTMLDivElement>(null);
  const poseSlotRef = useRef<HTMLDivElement>(null);

  // All pages share one scrolling area, so a new page starts at its top instead of where the last one was left.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    // A request for an analysis only lives while the AI Detection page is open; it never waits for a later visit.
    if (activeTab !== 'ai') setAiAnalyzePending(false);
  }, [activeTab]);

  // Smart Snapshot: capture, gallery (IndexedDB), downloads and their notifications.
  const smart = useSmartSnapshot();
  // Motion alerts reach the AI recognition panel through this bus (the panels do not know each other).
  const [motionBus] = useState(() => new MotionEventBus());

  // Derived state calculated accurately from current config state
  const isStreamConfigured = Boolean(config.baseUrl?.trim() && config.streamPath?.trim());
  const streamUrl = cameraService.getStreamUrl(config);
  const snapshotUrl = cameraService.getSnapshotUrl(config);
  const isMixedContent = isMixedContentRestricted(config.baseUrl);

  // The stream connection is owned by one StreamConnection instance.
  // It keeps a connection open while a page that shows the picture (Dashboard, AI Detection) is on screen in stream mode.
  const { health, attachImage, reconnect, measureHost, setAutoMeasure, clearHistory, getImage } = useStreamConnection({
    config,
    streamUrl,
    isMixedContent,
    viewing: (activeTab === 'feed' || activeTab === 'ai' || activeTab === 'pose') && viewMode === 'stream',
  });
  const connectionStatus = health.status;
  const isRecovering = connectionStatus === 'connecting' || connectionStatus === 'reconnecting';

  // Reparent the single persistent camera feed DOM node into whichever view slot is active
  useLayoutEffect(() => {
    const node = persistentFeedNodeRef.current;
    if (!node) return;

    if (activeTab === 'feed' && feedSlotRef.current) {
      if (node.parentElement !== feedSlotRef.current) {
        feedSlotRef.current.appendChild(node);
      }
    } else if (activeTab === 'ai' && aiSlotRef.current) {
      if (node.parentElement !== aiSlotRef.current) {
        aiSlotRef.current.appendChild(node);
      }
    } else if (activeTab === 'pose' && poseSlotRef.current) {
      if (node.parentElement !== poseSlotRef.current) {
        poseSlotRef.current.appendChild(node);
      }
    } else {
      if (persistentFeedHolderRef.current && node.parentElement !== persistentFeedHolderRef.current) {
        persistentFeedHolderRef.current.appendChild(node);
      }
    }

    return () => {
      // Park persistent element in the background holder during tab switches so the stream never drops
      if (persistentFeedHolderRef.current && node && node.parentElement !== persistentFeedHolderRef.current) {
        persistentFeedHolderRef.current.appendChild(node);
      }
    };
  }, [activeTab]);

  // "Last successful connection": recorded when the connection manager confirms a (re)connection
  useEffect(() => {
    if (health.connectedSince != null) {
      setLastConnectionTime(cameraService.recordSuccessfulConnection());
    }
  }, [health.connectedSince]);

  useEffect(() => {
    if (connectionStatus === 'host_reachable' && health.host.checkedAt != null) {
      setLastConnectionTime(cameraService.recordSuccessfulConnection());
    }
  }, [connectionStatus, health.host.checkedAt]);

  // Configuration persistence handlers
  const handleSaveConfig = (newConfig: CameraConfig) => {
    setConfig(cameraService.saveConfig(newConfig));
  };

  const handleResetDefaults = () => {
    setConfig(cameraService.resetToDefaults());
  };

  const handleEnableCapture = () => {
    setConfig(cameraService.saveConfig({ ...config, captureCors: true }));
  };

  const openSettings = () => setActiveTab('settings');
  const openNetworkGuide = () => setActiveTab('network-guide');
  const openEvents = (filter: EventFilter) => {
    setEventsFilter(filter);
    setActiveTab('events');
  };

  // Dashboard "AI Analyze": navigate to AI Detection and trigger one immediate analysis
  const handleAiAnalyze = () => {
    setViewMode('stream');
    setAiAnalyzePending(true);
    setActiveTab('ai');
  };
  const clearAiAnalyzePending = useCallback(() => setAiAnalyzePending(false), []);

  const statusDetail = describeStatus(health);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-slate-100 font-sans text-[13px]">
      <Header
        connectionStatus={connectionStatus}
        isMixedContent={isMixedContent}
        statusDetail={statusDetail}
        onOpenSettings={openSettings}
        onReconnect={reconnect}
        isReconnecting={isRecovering}
        onOpenNetworkGuide={openNetworkGuide}
        onOpenNavigation={() => setIsMobileSidebarOpen(true)}
      />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          config={config}
          connectionStatus={connectionStatus}
          isMixedContent={isMixedContent}
          connectedSince={health.connectedSince}
          isOpenMobile={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        {/* Scrollable View Area */}
        <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
          {activeTab === 'feed' && (
            <div className="max-w-[88rem] mx-auto space-y-6">
              {/* The live picture hero, its actions and the camera information card */}
              <CameraView
                config={config}
                streamUrl={streamUrl}
                isStreamConfigured={isStreamConfigured}
                health={health}
                attachImage={attachImage}
                getImage={getImage}
                isMixedContent={isMixedContent}
                viewMode={viewMode}
                onToggleViewMode={setViewMode}
                onReconnect={reconnect}
                onOpenSettings={openSettings}
                onOpenNetworkGuide={openNetworkGuide}
                smart={smart}
                onEnableCapture={handleEnableCapture}
                onAiAnalyze={handleAiAnalyze}
                feedSlot={<div ref={feedSlotRef} className="w-full h-full" />}
                sidePanel={
                  <CameraStatus
                    config={config}
                    streamUrl={streamUrl}
                    snapshotUrl={snapshotUrl}
                    connectionStatus={connectionStatus}
                    isStreamConfigured={isStreamConfigured}
                    lastConnectionTime={lastConnectionTime}
                    isMixedContent={isMixedContent}
                    statusDetail={statusDetail}
                    onOpenSettings={openSettings}
                  />
                }
              />

              <StreamStatCards health={health} viewMode={viewMode} snapshots={smart.items} />
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="max-w-[88rem] mx-auto space-y-6">
              {/* A. Professional Page Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-8 h-8 rounded-lg bg-raised border border-edge flex items-center justify-center text-cyan-300"
                      aria-hidden="true"
                    >
                      <ScanSearch className="w-5 h-5" />
                    </span>
                    <h1 className="text-xl font-bold tracking-tight text-white">AI Detection</h1>
                    <StatusBadge role="status" aria-live="polite" tone={aiBadge.tone} busy={aiBadge.busy}>
                      {aiBadge.label}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-slate-400">
                    Real-time edge surveillance with Groq vision AI and motion tracking.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEvents('ai')}
                    className={BTN_SECONDARY}
                    title="View full history of AI recognition events"
                  >
                    <ListChecks className="w-4 h-4" aria-hidden="true" />
                    <span>Recognition History</span>
                  </button>
                </div>
              </div>

              {/* FIRST: Groq AI Recognition (Mandatory Order) */}
              <AiRecognitionPanel
                feedSlot={<div ref={aiSlotRef} className="w-full h-full" />}
                viewMode={viewMode}
                isStreamConfigured={isStreamConfigured}
                health={health}
                getImage={getImage}
                streamUrl={streamUrl}
                config={config}
                smart={smart}
                motionBus={motionBus}
                onEnableCapture={handleEnableCapture}
                analyzePending={aiAnalyzePending}
                onAnalyzeHandled={clearAiAnalyzePending}
                onViewAll={() => openEvents('ai')}
                onStatusChange={setAiBadge}
              />

              {/* SECOND: Motion Detection (Mandatory Order) */}
              <MotionDetectionPanel
                viewMode={viewMode}
                isStreamConfigured={isStreamConfigured}
                health={health}
                getImage={getImage}
                streamUrl={streamUrl}
                config={config}
                smart={smart}
                onEnableCapture={handleEnableCapture}
                onMotionEvent={(event) => motionBus.emit(event)}
                onViewAll={() => openEvents('motion')}
              />
            </div>
          )}

          {activeTab === 'pose' && (
            <div className="max-w-[88rem] mx-auto space-y-6">
              <PoseEstimationPanel
                feedSlot={<div ref={poseSlotRef} className="w-full h-full" />}
                viewMode={viewMode}
                isStreamConfigured={isStreamConfigured}
                health={health}
                getImage={getImage}
                streamUrl={streamUrl}
                config={config}
              />
            </div>
          )}

          {activeTab === 'snapshots' && (
            <div className="max-w-[88rem] mx-auto">
              <SnapshotGallery smart={smart} onNavigateToFeed={() => setActiveTab('feed')} streamUrl={streamUrl} />
            </div>
          )}

          {activeTab === 'events' && (
            <div className="max-w-5xl mx-auto">
              <EventHistoryView
                key={eventsFilter}
                initialFilter={eventsFilter}
                health={health}
                smart={smart}
                onNavigateToFeed={() => setActiveTab('feed')}
              />
            </div>
          )}

          {activeTab === 'diagnostics' && (
            <div className="max-w-[88rem] mx-auto">
              <DiagnosticsPanel
                config={config}
                health={health}
                onReconnect={reconnect}
                onMeasureHost={measureHost}
                onSetAutoMeasure={setAutoMeasure}
                onClearHistory={clearHistory}
                onOpenSettings={openSettings}
                onOpenNetworkGuide={openNetworkGuide}
              />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-5xl mx-auto">
              <SettingsPage
                config={config}
                onSave={handleSaveConfig}
                onResetDefaults={handleResetDefaults}
                onOpenNetworkGuide={openNetworkGuide}
              />
            </div>
          )}

          {activeTab === 'network-guide' && (
            <div className="max-w-3xl mx-auto">
              <NetworkGuideView />
            </div>
          )}
        </main>
      </div>

      {/* Persistent Camera Feed Element: stays mounted across page navigation so the stream never drops */}
      <div style={{ display: 'none' }} aria-hidden="true">
        <div ref={persistentFeedHolderRef}>
          <div ref={persistentFeedNodeRef} className="w-full h-full">
            <CameraFeedBox
              config={config}
              streamUrl={streamUrl}
              isStreamConfigured={isStreamConfigured}
              health={health}
              attachImage={attachImage}
              isMixedContent={isMixedContent}
              viewMode={viewMode}
              onToggleViewMode={setViewMode}
              onReconnect={reconnect}
              onOpenSettings={openSettings}
              onOpenNetworkGuide={openNetworkGuide}
              smart={smart}
              onEnableCapture={handleEnableCapture}
              variant={activeTab === 'feed' ? 'hero' : 'compact'}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
