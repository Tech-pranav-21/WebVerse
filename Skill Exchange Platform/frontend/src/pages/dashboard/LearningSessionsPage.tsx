import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { LearningSession, SessionStatus } from '../../types';
import { Avatar } from '../../components/common/Avatar';
import { ScheduleSessionModal } from '../../components/modals/ScheduleSessionModal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { EmptyState } from '../../components/common/EmptyState';
import { 
  Calendar as CalendarIcon, 
  Plus, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  MapPin, 
  Edit3, 
  Video, 
  Users, 
  Sparkles,
  List,
  CalendarDays
} from 'lucide-react';

export const LearningSessionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    students, 
    sessions, 
    updateSessionStatus 
  } = useApp();

  const [activeTab, setActiveTab] = useState<'Upcoming' | 'Completed' | 'Cancelled'>('Upcoming');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<LearningSession | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  if (!currentUser) return null;

  // Filter sessions for current user
  const filteredSessions = useMemo(() => {
    return sessions
      .filter(s => s.status === activeTab)
      .sort((a, b) => {
        const timeA = `${a.date}T${a.startTime}`;
        const timeB = `${b.date}T${b.startTime}`;
        return activeTab === 'Upcoming' ? timeA.localeCompare(timeB) : timeB.localeCompare(timeA);
      });
  }, [sessions, activeTab]);

  const handleConfirmCancel = () => {
    if (confirmCancelId) {
      updateSessionStatus(confirmCancelId, 'Cancelled');
      setConfirmCancelId(null);
    }
  };

  const handleEdit = (session: LearningSession) => {
    setEditingSession(session);
    setScheduleModalOpen(true);
  };

  // Group by date for Calendar view
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, LearningSession[]>();
    sessions.forEach(s => {
      const list = map.get(s.date) || [];
      list.push(s);
      map.set(s.date, list);
    });
    return map;
  }, [sessions]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Learning Sessions
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Schedule, manage, and complete 1-on-1 peer learning meetups with your partners.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingSession(null);
            setScheduleModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs self-start sm:self-center"
        >
          <Plus className="w-3.5 h-3.5" />
          Schedule Session
        </button>
      </div>

      {/* Control bar: Tabs & View Mode */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-medium">
          {(['Upcoming', 'Completed', 'Cancelled'] as const).map(tab => {
            const count = sessions.filter(s => s.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg transition-colors ${
                  activeTab === tab
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab} ({count})
              </button>
            );
          })}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'list' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600'
            }`}
            title="List View"
            aria-label="List View"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'calendar' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600'
            }`}
            title="Calendar View"
            aria-label="Calendar View"
          >
            <CalendarDays className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* View Mode 1: List View */}
      {viewMode === 'list' && (
        <div className="space-y-4">
          {filteredSessions.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSessions.map(session => {
                const partner = students.find(s => s.id === session.partnerId);
                if (!partner) return null;

                return (
                  <div
                    key={session.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors"
                  >
                    <div className="space-y-3">
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                            {session.learningMethod} Session
                          </span>
                          <h3 className="text-sm font-bold text-slate-900 leading-snug mt-0.5">
                            {session.skillName}
                          </h3>
                        </div>
                        <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">
                          {session.durationMinutes} mins
                        </span>
                      </div>

                      {/* Partner info */}
                      <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <Avatar name={partner.name} initials={partner.initials} size="xs" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {partner.name}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {partner.college}
                          </p>
                        </div>
                      </div>

                      {/* Date & Time info */}
                      <div className="space-y-1.5 text-xs text-slate-600">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-800">{session.date}</span>
                          <span>·</span>
                          <span>{session.startTime}</span>
                        </div>
                        {session.notes && (
                          <p className="text-[11px] text-slate-500 italic line-clamp-2 pt-1 border-t border-slate-100">
                            "{session.notes}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="pt-3 mt-4 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                      {session.status === 'Upcoming' && (
                        <>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEdit(session)}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                              title="Reschedule / Edit"
                              aria-label="Edit"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setConfirmCancelId(session.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Cancel Session"
                              aria-label="Cancel"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>

                          <button
                            onClick={() => updateSessionStatus(session.id, 'Completed')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Mark Done
                          </button>
                        </>
                      )}

                      {session.status === 'Completed' && (
                        <div className="flex items-center justify-between w-full text-emerald-700 font-semibold text-[11px]">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Session Completed
                          </span>
                          <button
                            onClick={() => navigate('/skill-exchanges')}
                            className="text-indigo-600 hover:underline"
                          >
                            Exchanges →
                          </button>
                        </div>
                      )}

                      {session.status === 'Cancelled' && (
                        <span className="text-slate-400 italic text-[11px]">
                          Session was cancelled
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={CalendarIcon}
              title={`No ${activeTab} Sessions`}
              description={
                activeTab === 'Upcoming'
                  ? 'Plan focused 1-on-1 time with your exchange partner to practice coding or review portfolios.'
                  : 'No sessions recorded in this status.'
              }
              actionLabel={activeTab === 'Upcoming' ? 'Schedule a Session' : undefined}
              onAction={activeTab === 'Upcoming' ? () => setScheduleModalOpen(true) : undefined}
            />
          )}
        </div>
      )}

      {/* View Mode 2: Interactive Calendar Preview */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Learning Calendar Schedule
            </h3>
            <p className="text-xs text-slate-500">
              Interactive date agenda breakdown showing all planned sessions across months.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from(sessionsByDate.entries()).map(([dateStr, daySessions]) => (
              <div key={dateStr} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                  <span className="font-bold text-xs text-slate-900">{dateStr}</span>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    {daySessions.length} {daySessions.length === 1 ? 'session' : 'sessions'}
                  </span>
                </div>

                <div className="space-y-2 pt-1">
                  {daySessions.map(s => {
                    const partner = students.find(p => p.id === s.partnerId);
                    return (
                      <div key={s.id} className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs shadow-2xs">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-bold text-slate-900 truncate">{s.skillName}</span>
                          <span className="font-semibold text-indigo-600">{s.startTime}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          With {partner?.name} ({s.durationMinutes}m · {s.status})
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule / Edit Modal */}
      <ScheduleSessionModal
        isOpen={scheduleModalOpen}
        onClose={() => {
          setScheduleModalOpen(false);
          setEditingSession(null);
        }}
        editSessionItem={editingSession}
      />

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmCancelId}
        onClose={() => setConfirmCancelId(null)}
        onConfirm={handleConfirmCancel}
        title="Cancel Learning Session"
        message="Are you sure you want to cancel this scheduled learning session?"
        confirmLabel="Cancel Session"
        variant="danger"
      />
    </div>
  );
};
