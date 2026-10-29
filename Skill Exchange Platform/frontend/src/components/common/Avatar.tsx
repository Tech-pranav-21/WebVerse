import React from 'react';

interface AvatarProps {
  name: string;
  initials?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const COLOR_PAIRS = [
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200' },
  { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
];

export const Avatar: React.FC<AvatarProps> = ({
  name,
  initials,
  size = 'md',
  className = ''
}) => {
  // Deterministic color pair based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % COLOR_PAIRS.length;
  const color = COLOR_PAIRS[colorIndex];

  const derivedInitials = initials || name
    .split(' ')
    .filter(Boolean)
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'ST';

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm font-medium',
    lg: 'w-14 h-14 text-base font-semibold',
    xl: 'w-20 h-20 text-xl font-bold'
  }[size];

  return (
    <div
      className={`inline-flex items-center justify-center rounded-xl border select-none shrink-0 font-medium ${color.bg} ${color.text} ${color.border} ${sizeClasses} ${className}`}
      title={name}
      aria-label={name}
    >
      {derivedInitials}
    </div>
  );
};
