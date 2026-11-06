/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FILTERABLE_CATEGORIES } from '../../server/protocol';
import type { AiSettings } from '../types/ai';
import type { MotionRegion, MotionSensitivity, MotionSettings } from '../types/motion';
import { AI_COOLDOWN_OPTIONS_SEC, CATEGORY_LABELS, anyCategoryEnabled } from '../services/aiSettings';
import {
  CONFIRM_FRAME_OPTIONS,
  COOLDOWN_OPTIONS_SEC,
  INTERVAL_OPTIONS_MS,
  MAX_CHANGED_PERCENT,
  MIN_CHANGED_PERCENT_FLOOR,
  REGION_LABELS,
  SENSITIVITY_PRESETS,
  effectiveParams,
} from '../services/motionSettings';
import { CHECK, FIELD, Hint } from './ui';

/**
 * The motion detection and Groq recognition settings as form fields. They are shown on the AI
 * Detection page (wired to the running detectors) and on the Settings page (wired to the saved
 * settings), so the two always offer exactly the same options.
 */

const secondsLabel = (sec: number) => (sec >= 60 ? `${sec / 60} min` : `${sec} s`);
const intervalLabel = (ms: number) => (ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`);

/** A labelled control: the label sits above the field, so it works at any width. */
export const LabelledField: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  children,
}) => (
  <div className="flex flex-col gap-1.5 min-w-0">
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-slate-200">
      {label}
    </label>
    {children}
  </div>
);

interface MotionFieldsProps {
  settings: MotionSettings;
  onChange: (patch: Partial<MotionSettings>) => void;
  /** Makes the element ids unique when the fields appear twice in the app. */
  idPrefix: string;
}

/** Sensitivity, cooldown and the snapshot-on-motion option. */
export const MotionQuickFields: React.FC<MotionFieldsProps> = ({ settings, onChange, idPrefix }) => {
  const preset = SENSITIVITY_PRESETS[settings.sensitivity];
  const params = effectiveParams(settings);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 @md:grid-cols-2">
        <LabelledField label="Sensitivity" htmlFor={`${idPrefix}-sensitivity`}>
          <select
            id={`${idPrefix}-sensitivity`}
            value={settings.sensitivity}
            onChange={(e) => onChange({ sensitivity: e.target.value as MotionSensitivity })}
            className={`${FIELD} w-full`}
          >
            {(Object.keys(SENSITIVITY_PRESETS) as MotionSensitivity[]).map((level) => (
              <option key={level} value={level}>
                {SENSITIVITY_PRESETS[level].label}
              </option>
            ))}
          </select>
        </LabelledField>
        <LabelledField label="Alert cooldown" htmlFor={`${idPrefix}-cooldown`}>
          <select
            id={`${idPrefix}-cooldown`}
            value={settings.cooldownSec}
            onChange={(e) => onChange({ cooldownSec: Number(e.target.value) })}
            className={`${FIELD} w-full`}
          >
            {Array.from(new Set<number>([...COOLDOWN_OPTIONS_SEC, settings.cooldownSec])).sort((a, b) => a - b).map((sec) => (
              <option key={sec} value={sec}>
                {secondsLabel(sec)}
              </option>
            ))}
          </select>
        </LabelledField>
      </div>
      <Hint>
        {preset.description} Pixel noise tolerance {preset.pixelThreshold} of 255; an alert needs at least{' '}
        {params.minChangedPercent}% of the watched area to change, and there is no second alert during the cooldown.
      </Hint>
      <label className="flex items-start gap-2.5 text-[13px] text-slate-100 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.captureSnapshot}
          onChange={(e) => onChange({ captureSnapshot: e.target.checked })}
          className={`${CHECK} mt-0.5`}
        />
        <span>
          Capture snapshot on motion
          <span className="block text-xs text-slate-400 font-normal mt-0.5">
            Saves one real frame to the Snapshot Gallery per alert (never during the cooldown). Detection works without it.
          </span>
        </span>
      </label>
    </div>
  );
};

/** Check interval, confirmation frames, watched area and minimum changed area. */
export const MotionAdvancedFields: React.FC<MotionFieldsProps> = ({ settings, onChange, idPrefix }) => (
  <div className="space-y-3">
    <div className="grid gap-3 @md:grid-cols-2">
      <LabelledField label="Check the picture every" htmlFor={`${idPrefix}-interval`}>
        <select
          id={`${idPrefix}-interval`}
          value={settings.intervalMs}
          onChange={(e) => onChange({ intervalMs: Number(e.target.value) })}
          className={FIELD}
        >
          {Array.from(new Set<number>([...INTERVAL_OPTIONS_MS, settings.intervalMs])).sort((a, b) => a - b).map((ms) => (
            <option key={ms} value={ms}>
              {intervalLabel(ms)}
            </option>
          ))}
        </select>
      </LabelledField>
      <LabelledField label="Confirm over frames" htmlFor={`${idPrefix}-confirm`}>
        <select
          id={`${idPrefix}-confirm`}
          value={settings.confirmFrames}
          onChange={(e) => onChange({ confirmFrames: Number(e.target.value) })}
          className={FIELD}
        >
          {Array.from(new Set<number>([...CONFIRM_FRAME_OPTIONS, settings.confirmFrames])).sort((a, b) => a - b).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? '1 (no confirmation)' : `${n} in a row`}
            </option>
          ))}
        </select>
      </LabelledField>
      <LabelledField label="Watched area" htmlFor={`${idPrefix}-region`}>
        <select
          id={`${idPrefix}-region`}
          value={settings.region}
          onChange={(e) => onChange({ region: e.target.value as MotionRegion })}
          className={FIELD}
        >
          {(Object.keys(REGION_LABELS) as MotionRegion[]).map((r) => (
            <option key={r} value={r}>
              {REGION_LABELS[r]}
            </option>
          ))}
        </select>
      </LabelledField>
      <LabelledField label="Minimum changed area (%)" htmlFor={`${idPrefix}-minarea`}>
        <input
          id={`${idPrefix}-minarea`}
          type="number"
          inputMode="decimal"
          min={MIN_CHANGED_PERCENT_FLOOR}
          max={MAX_CHANGED_PERCENT}
          step={0.5}
          placeholder={`${SENSITIVITY_PRESETS[settings.sensitivity].minChangedPercent} (preset)`}
          value={settings.minChangedPercent ?? ''}
          onChange={(e) => onChange({ minChangedPercent: e.target.value === '' ? null : Number(e.target.value) })}
          className={FIELD}
        />
      </LabelledField>
    </div>
    <Hint>
      Leave the minimum empty to use the sensitivity preset. Values below {MIN_CHANGED_PERCENT_FLOOR}% are raised to{' '}
      {MIN_CHANGED_PERCENT_FLOOR}%, because changes that small are indistinguishable from camera noise.
    </Hint>
  </div>
);

interface AiFieldsProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  idPrefix: string;
  /** Show the master switch ("Enable external AI processing") as the first field. */
  showEnable?: boolean;
}

/** The master switch, automatic analysis on motion, the cooldown, the result filters and snapshot keeping. */
export const AiSettingsFields: React.FC<AiFieldsProps> = ({ settings, onChange, idPrefix, showEnable = false }) => (
  <div className="space-y-5">
    {showEnable && (
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className={`${CHECK} mt-0.5`}
        />
        <span className="text-[13px] text-slate-100">
          Enable External AI Processing
          <span className="block text-xs text-slate-400 font-normal mt-0.5">
            Off by default. While it is off, no image is ever sent anywhere.
          </span>
        </span>
      </label>
    )}

    <div className="grid gap-5 @2xl:grid-cols-2">
      <div className="space-y-3 min-w-0">
        <label
          className={`flex items-start gap-2.5 text-[13px] cursor-pointer ${settings.enabled && settings.autoAcknowledged ? 'text-slate-100' : 'text-slate-400'}`}
        >
          <input
            type="checkbox"
            checked={settings.autoOnMotion}
            disabled={!settings.enabled || !settings.autoAcknowledged}
            onChange={(e) => onChange({ autoOnMotion: e.target.checked })}
            className={`${CHECK} mt-0.5`}
          />
          <span>
            Analyze automatically when motion is detected
            <span className="block text-xs text-slate-400 font-normal mt-0.5">
              Uses Motion Detection alerts: it must be running. At most one analysis per cooldown, one at a time.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <input
            type="checkbox"
            checked={settings.autoAcknowledged}
            disabled={!settings.enabled}
            onChange={(e) => onChange({ autoAcknowledged: e.target.checked })}
            className={`${CHECK} mt-0.5`}
          />
          <span>
            I understand that, with automatic analysis on, a still image from my camera is sent to Groq (an external
            service) each time motion is detected, and that this uses my Groq quota.
          </span>
        </label>
        <LabelledField label="Cooldown between automatic analyses" htmlFor={`${idPrefix}-ai-cooldown`}>
          <select
            id={`${idPrefix}-ai-cooldown`}
            value={settings.cooldownSec}
            onChange={(e) => onChange({ cooldownSec: Number(e.target.value) })}
            className={`${FIELD} w-32`}
          >
            {Array.from(new Set<number>([...AI_COOLDOWN_OPTIONS_SEC, settings.cooldownSec])).sort((a, b) => a - b).map((sec) => (
              <option key={sec} value={sec}>
                {secondsLabel(sec)}
              </option>
            ))}
          </select>
        </LabelledField>
      </div>

      <fieldset className="space-y-3 min-w-0">
        <legend className="text-[13px] font-medium text-slate-200 mb-1">Which results count as an event</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {FILTERABLE_CATEGORIES.map((c) => (
            <label key={c} className="inline-flex items-center gap-2 text-[13px] text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.categories[c]}
                onChange={(e) => onChange({ categories: { ...settings.categories, [c]: e.target.checked } })}
                className={CHECK}
              />
              <span>{CATEGORY_LABELS[c]}</span>
            </label>
          ))}
        </div>
        {!anyCategoryEnabled(settings) && (
          <p className="text-xs text-amber-300">No category is selected, so no result will count as an event.</p>
        )}
        <label className="flex items-start gap-2.5 text-[13px] text-slate-100 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.retainSnapshot}
            onChange={(e) => onChange({ retainSnapshot: e.target.checked })}
            className={`${CHECK} mt-0.5`}
          />
          <span>
            Keep a snapshot when a result matches
            <span className="block text-xs text-slate-400 font-normal mt-0.5">
              Saves the analysed frame to the Snapshot Gallery (no banner). Results the model is unsure about never count.
              If Motion Detection already saves a snapshot for the same alert, no second one is taken.
            </span>
          </span>
        </label>
      </fieldset>
    </div>
  </div>
);
