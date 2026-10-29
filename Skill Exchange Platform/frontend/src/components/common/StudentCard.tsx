import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Student, MatchScoreResult } from '../../types';
import { useApp } from '../../context/AppContext';
import { Avatar } from './Avatar';
import { SkillBadge } from './SkillBadge';
import { RatingStars } from './RatingStars';
import { MapPin, Sparkles, Send, MessageSquare, Bookmark, Check, Clock } from 'lucide-react';

interface StudentCardProps {
  student: Student;
  matchResult?: MatchScoreResult;
  onProposeExchange?: (student: Student) => void;
  showProposeButton?: boolean;
}

export const StudentCard: React.FC<StudentCardProps> = ({
  student,
  matchResult,
  onProposeExchange,
  showProposeButton = true
}) => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    getConnectionWith, 
    sendConnectionRequest, 
    savedProfileIds, 
    toggleSaveProfile 
  } = useApp();

  const isSelf = currentUser?.id === student.id;
  const connection = getConnectionWith(student.id);
  const isSaved = savedProfileIds.includes(student.id);

  const handleConnectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (!connection) {
      sendConnectionRequest(student.id);
    } else if (connection.status === 'Accepted') {
      navigate(`/messages?student=${student.id}`);
    }
  };

  const handleProposeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (onProposeExchange) {
      onProposeExchange(student);
    } else {
      navigate(`/skill-exchanges?propose=${student.id}`);
    }
  };

  return (
    <div 
      onClick={() => navigate(`/students/${student.id}`)}
      className="bg-white rounded-2xl border border-slate-200/90 hover:border-indigo-300 p-5 transition-all duration-200 hover:shadow-md cursor-pointer flex flex-col justify-between group"
    >
      <div>
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <Avatar name={student.name} initials={student.initials} size="md" />
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  {student.name}
                </h4>
                {isSelf && (
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                    You
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 line-clamp-1">
                {student.department} · {student.yearOfStudy}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!isSelf && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSaveProfile(student.id);
                }}
                className={`p-1.5 rounded-lg transition-colors ${
                  isSaved ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                }`}
                title={isSaved ? 'Bookmarked' : 'Bookmark profile'}
                aria-label={isSaved ? 'Bookmarked' : 'Bookmark profile'}
              >
                <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-indigo-600' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* College & Rating row */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mb-3 pt-1 border-t border-slate-50">
          <div className="flex items-center gap-1 text-slate-600 font-medium">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate max-w-[180px]">{student.college}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <RatingStars rating={student.rating} size="sm" showNumber reviewCount={student.reviewCount} />
          </div>
        </div>

        {/* Bio */}
        <p className="text-xs text-slate-600 line-clamp-2 mb-4 leading-relaxed">
          {student.bio}
        </p>

        {/* Match Score Banner if present */}
        {matchResult && (
          <div className="mb-4 p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-indigo-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                {matchResult.compatibilityLabel}
              </span>
              <span className="font-bold text-indigo-600 tabular-nums text-xs">
                {matchResult.score}% Compatibility
              </span>
            </div>
            <p className="text-[11px] text-indigo-700 leading-snug">
              {matchResult.explanation}
            </p>
          </div>
        )}

        {/* Skills Section */}
        <div className="space-y-2.5 mb-4">
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Can Teach ({student.skillsOffered.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {student.skillsOffered.slice(0, 3).map(skill => (
                <SkillBadge 
                  key={skill.id} 
                  name={skill.name} 
                  proficiency={skill.proficiency}
                  variant="offered"
                  size="sm"
                />
              ))}
              {student.skillsOffered.length > 3 && (
                <span className="text-[11px] text-slate-400 self-center">
                  +{student.skillsOffered.length - 3} more
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Wants To Learn ({student.skillsWanted.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {student.skillsWanted.slice(0, 3).map(skill => (
                <SkillBadge 
                  key={skill.id} 
                  name={skill.name} 
                  priority={skill.priority}
                  variant="wanted"
                  size="sm"
                />
              ))}
              {student.skillsWanted.length > 3 && (
                <span className="text-[11px] text-slate-400 self-center">
                  +{student.skillsWanted.length - 3} more
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer Actions */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/students/${student.id}`);
          }}
          className="text-xs font-medium text-slate-600 hover:text-indigo-600 px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          View Profile
        </button>

        {!isSelf && (
          <div className="flex items-center gap-1.5">
            {connection?.status === 'Accepted' ? (
              <button
                type="button"
                onClick={handleConnectClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
                Message
              </button>
            ) : connection?.status === 'Pending' ? (
              <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg border border-amber-200/60">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                Pending
              </span>
            ) : (
              <button
                type="button"
                onClick={handleConnectClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200/70"
              >
                <Send className="w-3.5 h-3.5 text-indigo-600" />
                Connect
              </button>
            )}

            {showProposeButton && (
              <button
                type="button"
                onClick={handleProposeClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
              >
                Propose
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
