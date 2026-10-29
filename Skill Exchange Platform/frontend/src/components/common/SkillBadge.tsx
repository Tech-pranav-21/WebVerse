import React from 'react';
import { ProficiencyLevel, SkillPriority } from '../../types';

interface SkillBadgeProps {
  name: string;
  proficiency?: ProficiencyLevel;
  priority?: SkillPriority;
  category?: string;
  variant?: 'offered' | 'wanted' | 'neutral';
  size?: 'sm' | 'md';
}

export const SkillBadge: React.FC<SkillBadgeProps> = ({
  name,
  proficiency,
  priority,
  variant = 'neutral',
  size = 'md'
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'offered':
        return 'bg-indigo-50/80 text-indigo-700 border-indigo-200/70';
      case 'wanted':
        return 'bg-violet-50/80 text-violet-700 border-violet-200/70';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const sizeClass = size === 'sm' ? 'text-xs px-2.5 py-1' : 'text-xs px-3 py-1.5';

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg border font-medium ${getVariantStyles()} ${sizeClass}`}>
      <span className="font-medium text-slate-900">{name}</span>
      {proficiency && (
        <span className="text-[11px] text-slate-500 font-normal">
          · {proficiency}
        </span>
      )}
      {priority && (
        <span className="text-[11px] text-violet-600 font-normal">
          · {priority} Priority
        </span>
      )}
    </div>
  );
};
