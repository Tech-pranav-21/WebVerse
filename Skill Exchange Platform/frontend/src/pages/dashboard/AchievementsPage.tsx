import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Award, 
  CheckCircle2, 
  Lock, 
  Sparkles, 
  Repeat, 
  Calendar, 
  Users, 
  Star, 
  BookOpen, 
  Handshake, 
  GraduationCap 
} from 'lucide-react';

export const AchievementsPage: React.FC = () => {
  const { 
    currentUser, 
    achievements, 
    exchanges, 
    sessions, 
    connections 
  } = useApp();

  if (!currentUser) return null;

  const earnedAchievements = useMemo(() => {
    return achievements.filter(a => a.isUnlocked);
  }, [achievements]);

  const lockedAchievements = useMemo(() => {
    return achievements.filter(a => !a.isUnlocked);
  }, [achievements]);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Handshake': return Handshake;
      case 'Repeat': return Repeat;
      case 'Sparkles': return Sparkles;
      case 'GraduationCap': return GraduationCap;
      case 'Star': return Star;
      case 'Users': return Users;
      default: return Award;
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-700 rounded-3xl p-6 sm:p-8 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-200 bg-white/10 px-3 py-1 rounded-full">
            <Award className="w-3.5 h-3.5 text-amber-300" />
            <span>Collegiate Milestone Tracker</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Learning Achievements & Badges
          </h1>
          <p className="text-xs sm:text-sm text-indigo-100 leading-relaxed">
            Every badge is verified and tied directly to your active peer exchanges, scheduled sessions, and verified reviews.
          </p>
        </div>

        {/* Milestone counter */}
        <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-xs border border-white/20 text-center shrink-0">
          <span className="text-3xl font-extrabold text-white tabular-nums">
            {earnedAchievements.length} / {achievements.length}
          </span>
          <span className="text-xs text-indigo-200 block mt-0.5 font-medium">
            Badges Unlocked
          </span>
        </div>
      </div>

      {/* SECTION 1: Unlocked Badges */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            Earned Badges ({earnedAchievements.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {earnedAchievements.map(ach => {
            const Icon = getIcon(ach.icon);
            return (
              <div
                key={ach.id}
                className="bg-white rounded-2xl border border-emerald-200/80 p-5 shadow-xs space-y-3 relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center shrink-0 shadow-2xs">
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    Unlocked {ach.unlockedAt || ''}
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-snug">
                    {ach.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {ach.description}
                  </p>
                </div>

                <div className="text-[11px] font-semibold text-emerald-600 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span>Category: {ach.category}</span>
                  <span className="tabular-nums">Completed ({ach.progress}/{ach.maxProgress})</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 2: Locked Badges with Live Progress Bars */}
      <section className="space-y-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
            <Lock className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            Locked Badges & In-Progress Goals ({lockedAchievements.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lockedAchievements.map(ach => {
            const Icon = getIcon(ach.icon);
            const percent = Math.min(100, Math.round((ach.progress / ach.maxProgress) * 100));

            return (
              <div
                key={ach.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3 opacity-90"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-800 leading-snug">
                    {ach.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {ach.description}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                    <span>Progress</span>
                    <span className="tabular-nums">{ach.progress} / {ach.maxProgress} ({percent}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div 
                      className="h-full bg-indigo-600 rounded-full transition-all duration-300" 
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
