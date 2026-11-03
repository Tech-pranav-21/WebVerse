/**
 * PoseKeypointInspector
 * The "Keypoint Coordinates" card of the Pose Estimation page: a person selector and the 17 COCO keypoints
 * with their pixel positions. Moved out of PoseEstimationPanel unchanged (apart from person numbering, which
 * now matches the activity cards) so it can be rendered on its own.
 */

import React from 'react';
import { Layers } from 'lucide-react';
import type { PoseDetectionResult } from '../types/pose';
import { personTitle } from '../services/activityPresentation';

export interface PoseKeypointInspectorProps {
  result: PoseDetectionResult;
  selectedIdx: number;
  onSelect: (index: number) => void;
}

export const PoseKeypointInspector: React.FC<PoseKeypointInspectorProps> = ({ result, selectedIdx, onSelect }) => {
  if (result.person_count <= 0 || result.persons.length === 0) return null;
  const idx = selectedIdx < result.persons.length ? selectedIdx : 0;
  const selected = result.persons[idx];

  return (
    <div className="p-3.5 rounded-xl bg-sunken border border-line space-y-3">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          Keypoint Coordinates ({personTitle(selected, idx)})
        </div>
        {result.person_count > 1 && (
          <div className="flex gap-1">
            {result.persons.map((person, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(i)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  idx === i ? 'bg-cyan-500 text-black font-bold' : 'bg-raised text-slate-300'
                }`}
              >
                #{person.track_id ?? i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 17 Keypoints Pill Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
        {selected.keypoints.map((kp) => (
          <div
            key={kp.id}
            className={`p-1.5 rounded border text-[11px] flex items-center justify-between ${
              kp.visible
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-slate-800 bg-slate-900/50 text-slate-400'
            }`}
          >
            <span className="font-medium truncate capitalize">{kp.name.replace('_', ' ')}</span>
            <span className="font-mono text-[10px] text-slate-400">
              {kp.visible ? `${Math.round(kp.x)},${Math.round(kp.y)}` : 'unseen'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
