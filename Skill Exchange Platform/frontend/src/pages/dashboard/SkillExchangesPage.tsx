import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { SkillExchange, ExchangeStatus, Student } from '../../types';
import { Avatar } from '../../components/common/Avatar';
import { ProposeExchangeModal } from '../../components/modals/ProposeExchangeModal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { WriteReviewModal } from '../../components/modals/WriteReviewModal';
import { EmptyState } from '../../components/common/EmptyState';
import { 
  Repeat, 
  Plus, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Calendar, 
  Star, 
  Clock, 
  Check, 
  MessageSquare,
  ArrowRight,
  Sparkles
} from 'lucide-react';

export const SkillExchangesPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { 
    currentUser, 
    students, 
    exchanges, 
    updateExchangeStatus,
    reviews
  } = useApp();

  const [activeTab, setActiveTab] = useState<'all' | 'Pending' | 'Active' | 'Completed' | 'Cancelled'>('all');
  const [proposeModalOpen, setProposeModalOpen] = useState(false);
  const [preselectedStudent, setPreselectedStudent] = useState<Student | null>(null);

  // Review modal state
  const [reviewModalData, setReviewModalData] = useState<{
    exchange: SkillExchange;
    partner: Student;
  } | null>(null);

  // Cancel confirmation state
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // Check if query param `propose=<id>` is passed
  useEffect(() => {
    const proposeId = searchParams.get('propose');
    if (proposeId) {
      const partner = students.find(s => s.id === proposeId);
      if (partner) {
        setPreselectedStudent(partner);
        setProposeModalOpen(true);
      }
    }
  }, [searchParams, students]);

  if (!currentUser) return null;

  // Filter exchanges involving current user
  const myExchanges = useMemo(() => {
    return exchanges.filter(
      e => e.proposerId === currentUser.id || e.partnerId === currentUser.id
    );
  }, [exchanges, currentUser]);

  const filteredExchanges = useMemo(() => {
    if (activeTab === 'all') return myExchanges;
    return myExchanges.filter(e => e.status === activeTab);
  }, [myExchanges, activeTab]);

  const handleConfirmCancel = () => {
    if (confirmCancelId) {
      updateExchangeStatus(confirmCancelId, 'Cancelled');
      setConfirmCancelId(null);
    }
  };

  const getStatusBadge = (status: ExchangeStatus) => {
    switch (status) {
      case 'Active':
        return <span className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md">In Progress</span>;
      case 'Completed':
        return <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">Completed</span>;
      case 'Pending':
        return <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">Proposal Pending</span>;
      case 'Accepted':
        return <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">Proposal Accepted</span>;
      case 'Cancelled':
        return <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">Cancelled</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Skill Exchanges
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Coordinate two-way peer learning agreements. Both partners commit to mutual teaching sessions.
          </p>
        </div>

        <button
          onClick={() => {
            setPreselectedStudent(null);
            setProposeModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs self-start sm:self-center"
        >
          <Plus className="w-3.5 h-3.5" />
          Propose New Exchange
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit text-xs font-medium overflow-x-auto">
        {(['all', 'Pending', 'Active', 'Completed', 'Cancelled'] as const).map(tab => {
          const count = tab === 'all' 
            ? myExchanges.length 
            : myExchanges.filter(e => e.status === tab).length;

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'all' ? 'All Exchanges' : tab} ({count})
            </button>
          );
        })}
      </div>

      {/* Exchange Cards List */}
      {filteredExchanges.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredExchanges.map(exchange => {
            const isProposer = exchange.proposerId === currentUser.id;
            const partnerId = isProposer ? exchange.partnerId : exchange.proposerId;
            const partner = students.find(s => s.id === partnerId);
            if (!partner) return null;

            // What current user teaches vs learns
            const whatITeach = isProposer ? exchange.teachSkillName : exchange.learnSkillName;
            const whatILearn = isProposer ? exchange.learnSkillName : exchange.teachSkillName;

            // Check if already reviewed by current user
            const hasReviewed = reviews.some(r => r.exchangeId === exchange.id && r.authorId === currentUser.id);

            return (
              <div
                key={exchange.id}
                className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors"
              >
                <div className="space-y-4">
                  {/* Top: Partner & Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={partner.name} initials={partner.initials} size="md" />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">{partner.name}</h3>
                          <span className="text-[11px] text-slate-500">({partner.department})</span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {isProposer ? 'You sent this proposal' : 'You received this proposal'}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(exchange.status)}
                  </div>

                  {/* Skills Matchup Box */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 block">
                          You Teach
                        </span>
                        <p className="font-bold text-slate-900 mt-0.5">{whatITeach}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 block">
                          You Learn
                        </span>
                        <p className="font-bold text-slate-900 mt-0.5">{whatILearn}</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Schedule: <strong className="text-slate-700">{exchange.proposedSchedule}</strong></span>
                    </div>
                  </div>

                  {/* Description */}
                  {exchange.description && (
                    <p className="text-xs text-slate-600 leading-relaxed italic">
                      "{exchange.description}"
                    </p>
                  )}
                </div>

                {/* Bottom Action Footer with Status Transitions */}
                <div className="pt-4 mt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => navigate(`/messages?student=${partner.id}`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Chat
                    </button>
                    <button
                      onClick={() => navigate(`/students/${partner.id}`)}
                      className="px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                    >
                      Profile
                    </button>
                  </div>

                  {/* Transition Buttons */}
                  <div className="flex items-center gap-2">
                    {/* If Pending and current user is receiver -> can Accept / Decline */}
                    {exchange.status === 'Pending' && !isProposer && (
                      <>
                        <button
                          onClick={() => updateExchangeStatus(exchange.id, 'Cancelled')}
                          className="px-3 py-1.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => updateExchangeStatus(exchange.id, 'Accepted')}
                          className="px-3 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
                        >
                          Accept Proposal
                        </button>
                      </>
                    )}

                    {/* If Pending and current user is proposer -> can Cancel */}
                    {exchange.status === 'Pending' && isProposer && (
                      <button
                        onClick={() => setConfirmCancelId(exchange.id)}
                        className="px-3 py-1.5 font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        Cancel Proposal
                      </button>
                    )}

                    {/* If Accepted -> can Start (make Active) */}
                    {exchange.status === 'Accepted' && (
                      <button
                        onClick={() => updateExchangeStatus(exchange.id, 'Active')}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Start Active Exchange
                      </button>
                    )}

                    {/* If Active -> can Schedule Session or Mark Completed */}
                    {exchange.status === 'Active' && (
                      <>
                        <button
                          onClick={() => navigate('/sessions')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          Sessions
                        </button>
                        <button
                          onClick={() => updateExchangeStatus(exchange.id, 'Completed')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Mark Completed
                        </button>
                      </>
                    )}

                    {/* If Completed -> Review partner! */}
                    {exchange.status === 'Completed' && (
                      <>
                        {hasReviewed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                            <Check className="w-3 h-3" /> Reviewed
                          </span>
                        ) : (
                          <button
                            onClick={() => setReviewModalData({ exchange, partner })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-xs"
                          >
                            <Star className="w-3.5 h-3.5" />
                            Leave Review
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Repeat}
          title="No Exchanges Found"
          description="Propose a skill exchange with a student whose offerings complement your learning goals."
          actionLabel="Propose an Exchange"
          onAction={() => setProposeModalOpen(true)}
        />
      )}

      {/* Propose Modal */}
      <ProposeExchangeModal
        isOpen={proposeModalOpen}
        onClose={() => {
          setProposeModalOpen(false);
          setPreselectedStudent(null);
        }}
        preselectedPartner={preselectedStudent}
      />

      {/* Write Review Modal */}
      {reviewModalData && (
        <WriteReviewModal
          isOpen={true}
          onClose={() => setReviewModalData(null)}
          exchange={reviewModalData.exchange}
          partner={reviewModalData.partner}
        />
      )}

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmCancelId}
        onClose={() => setConfirmCancelId(null)}
        onConfirm={handleConfirmCancel}
        title="Cancel Skill Exchange"
        message="Are you sure you want to cancel this skill exchange proposal?"
        confirmLabel="Cancel Exchange"
        variant="danger"
      />
    </div>
  );
};
