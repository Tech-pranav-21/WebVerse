/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Camera, RotateCcw, ScanSearch, Settings as SettingsIcon, SlidersHorizontal, Activity } from 'lucide-react';
import type { CameraConfig } from '../types/camera';
import type { AiSettings } from '../types/ai';
import type { MotionSettings } from '../types/motion';
import { browserStore } from '../hooks/useStreamConnection';
import type { KeyValueStore } from '../services/connectionHistory';
import { loadAiSettings, normalizeAiSettings, saveAiSettings } from '../services/aiSettings';
import { loadSettings, normalizeSettings, saveSettings } from '../services/motionSettings';
import { CameraSettingsForm } from './CameraSettingsForm';
import { AiSettingsFields, MotionAdvancedFields, MotionQuickFields } from './settingsFields';
import { BTN_DANGER, BTN_SECONDARY, Hint, Notice, Panel, Tabs } from './ui';

interface SettingsPageProps {
  config: CameraConfig;
  onSave: (newConfig: CameraConfig) => void;
  onResetDefaults: () => void;
  onOpenNetworkGuide: () => void;
}

type SettingsTab = 'camera' | 'ai' | 'motion' | 'general';

const TAB_ITEMS: { id: SettingsTab; label: string }[] = [
  { id: 'camera', label: 'Camera' },
  { id: 'ai', label: 'AI & Recognition' },
  { id: 'motion', label: 'Motion Detection' },
  { id: 'general', label: 'General' },
];

/**
 * Settings that live in this browser (motion and AI recognition): read once, and every change is
 * validated by the same `normalize` function the detectors use and saved at once. The detectors
 * read them when the AI Detection page opens, so nothing here can disturb a running detection.
 */
function useStoredSettings<T extends object>(
  load: (store: KeyValueStore | null) => T,
  normalize: (input: unknown) => T,
  save: (store: KeyValueStore | null, value: T) => boolean,
) {
  const store = useMemo(() => browserStore(), []);
  const [value, setValue] = useState<T>(() => load(store));
  const [saveFailed, setSaveFailed] = useState(false);
  const update = useCallback(
    (patch: Partial<T>) => {
      const next = normalize({ ...value, ...patch });
      setValue(next);
      setSaveFailed(!save(store, next));
    },
    [value, normalize, save, store],
  );
  return { value, update, saveFailed };
}

const SaveFailedNotice: React.FC = () => (
  <Notice tone="warn">
    <p>This browser would not save the setting (private window or blocked site data), so it applies only until the page is closed.</p>
  </Notice>
);

/** The Settings page: camera configuration, AI recognition, motion detection and general options, in tabs. */
export const SettingsPage: React.FC<SettingsPageProps> = ({ config, onSave, onResetDefaults, onOpenNetworkGuide }) => {
  const [tab, setTab] = useState<SettingsTab>('camera');
  const ai = useStoredSettings<AiSettings>(loadAiSettings, normalizeAiSettings, saveAiSettings);
  const motion = useStoredSettings<MotionSettings>(loadSettings, normalizeSettings, saveSettings);
  const [confirmReset, setConfirmReset] = useState(false);

  // "Reset" asks twice; the question expires so it cannot be answered by accident later.
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  return (
    <div className="space-y-4">
      <Panel id="settings" title="Settings" icon={SettingsIcon}>
        <Tabs items={TAB_ITEMS} value={tab} onChange={(id) => setTab(id)} label="Settings sections" idBase="settings" />
      </Panel>

      <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`} className="space-y-4">
        {tab === 'camera' && (
          <Panel
            id="settings-camera"
            title="Camera Configuration"
            icon={Camera}
            description="Where the ESP32-CAM is and how this dashboard reaches it. Changes apply when you save."
          >
            <CameraSettingsForm currentConfig={config} onSave={onSave} />
          </Panel>
        )}

        {tab === 'ai' && (
          <Panel
            id="settings-ai"
            title="AI Provider Settings"
            icon={ScanSearch}
            description="Multi-provider AI vision (Groq, Gemini, OpenAI) analyzes camera frames. Configure provider/model in the AI Detection panel."
          >
            <Notice tone="warn">
              <p>
                <strong className="text-amber-200">Your camera image leaves this computer</strong> whenever a frame is
                analyzed. Nothing is sent while external AI processing is off.
              </p>
            </Notice>
            {ai.saveFailed && <SaveFailedNotice />}
            <AiSettingsFields settings={ai.value} onChange={ai.update} idPrefix="settings" showEnable />
            <Hint>
              Provider API keys and models are configured server-side in the backend <code className="font-mono">.env</code>.
              They are never stored in this browser. The AI Detection page shows the active provider and model.
            </Hint>
          </Panel>
        )}

        {tab === 'motion' && (
          <Panel
            id="settings-motion"
            title="Motion Detection"
            icon={Activity}
            description="How the browser compares frames of the live picture. These are the same options as on the AI Detection page."
          >
            {motion.saveFailed && <SaveFailedNotice />}
            <MotionQuickFields settings={motion.value} onChange={motion.update} idPrefix="settings-motion" />
            <div className="pt-4 border-t border-line space-y-3">
              <h3 className="text-sm font-semibold text-white">Advanced</h3>
              <MotionAdvancedFields settings={motion.value} onChange={motion.update} idPrefix="settings-motion" />
            </div>
          </Panel>
        )}

        {tab === 'general' && (
          <Panel
            id="settings-general"
            title="General"
            icon={SlidersHorizontal}
            description="Defaults, help and where this dashboard keeps its data."
          >
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-white">Camera defaults</h3>
              <Hint>
                Resets the camera address, routes and recovery options to the values from the environment file
                (<code className="font-mono">.env</code>). Motion and AI settings, snapshots and histories are not touched.
              </Hint>
              <button
                type="button"
                onClick={() => {
                  if (!confirmReset) {
                    setConfirmReset(true);
                    return;
                  }
                  setConfirmReset(false);
                  onResetDefaults();
                }}
                className={BTN_DANGER}
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>{confirmReset ? 'Click again to reset' : 'Reset to env defaults'}</span>
              </button>
            </div>

            <div className="pt-4 border-t border-line space-y-2">
              <h3 className="text-sm font-semibold text-white">Help</h3>
              <button type="button" onClick={onOpenNetworkGuide} className={BTN_SECONDARY}>
                <BookOpen className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                <span>Network and CORS guide</span>
              </button>
            </div>

            <div className="pt-4 border-t border-line space-y-2">
              <h3 className="text-sm font-semibold text-white">Where your data is kept</h3>
              <Hint>
                Everything stays in this browser on this computer: the camera settings, motion and AI settings and the
                event histories in local storage, and the snapshots in IndexedDB. Nothing is uploaded, except a single
                frame to Groq when you analyze one with AI recognition switched on. Clearing this site's data in the
                browser removes all of it.
              </Hint>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
};
