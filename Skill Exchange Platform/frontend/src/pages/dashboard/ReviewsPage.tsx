import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { RatingStars } from '../../components/common/RatingStars';
import { Avatar } from '../../components/common/Avatar';
import { WriteReviewModal } from '../../components/modals/WriteReviewModal';
import { EmptyState } from '../../components/common/EmptyState';
import { Student, SkillExchange } from '../../types';
import { Star, MessageSquare, CheckCircle2, Award, Clock } from 'lucide-react';

export const ReviewsPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    students, 
    reviews, 
    exchanges 
  } = useApp();

  const [activeTab, setActiveTab] = useState<'received' | 'written' | 'eligible'>('received');
  const [reviewModalData, setReviewModalData] = useState<{
    exchange: SkillExchange;
    partner: Student;
  } | null>(null);

  if (!currentUser) return null;

  // 1. Reviews received by current student
  const receivedReviews = useMemo(() => {
    return reviews.filter(r => r.targetStudentId === currentUser.id);
  }, [reviews, currentUser]);

  // 2. Reviews written by current student
  const writtenReviews = useMemo(() => {
    return reviews.filter(r => r.authorId === currentUser.id);
  }, [reviews, currentUser]);

  // 3. Completed exchanges eligible for review (where current user hasn't reviewed yet)
  const eligibleExchanges = useMemo(() => {
    return exchanges.filter(e => {
      const isParticipant = e.proposerId === currentUser.id || e.partnerId === currentUser.id;
      if (!isParticipant || e.status !== 'Completed') return false;

      // Check if current user already submitted a review for this exchange
      const alreadyReviewed = reviews.some(r => r.exchangeId === e.id && r.authorId === currentUser.id);
      return !alreadyReviewed;
    });
  }, [exchanges, reviews, currentUser]);

  // Calculate average rating
  const averageRating = useMemo(() => {
    if (receivedReviews.length === 0) return currentUser.rating;
    const sum = receivedReviews.reduce((acc, r) => acc + r.rating, 0);
    return Number((sum / receivedReviews.length).toFixed(1));
  }, [receivedReviews, currentUser]);

  return (
    <div className="space-y-6">
      {/* Top Summary Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Peer Reviews & Ratings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Reviews validate your communication, teaching patience, and subject mastery on completed exchanges.
          </p>
          <p className="text-[11px] text-slate-400 italic pt-1">
            * All reviews are demonstrative and persisted locally in the browser environment.
          </p>
        </div>

        {/* Rating Score Card */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80 shrink-0">
          <div className="text-center">
            <span className="text-3xl font-extrabold text-slate-900 tabular-nums leading-none">
              {averageRating.toFixed(1)}
            </span>
            <div className="mt-1">
              <RatingStars rating={averageRating} size="sm" />
            </div>
          </div>
          <div className="h-10 w-px bg-slate-200" />
          <div className="text-xs text-slate-600">
            <span className="font-bold text-slate-900 tabular-nums block">
              {receivedReviews.length} {receivedReviews.length === 1 ? 'Review' : 'Reviews'}
            </span>
            <span className="text-[11px] text-slate-500">Received from peers</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit text-xs font-medium">
        <button
          onClick={() => setActiveTab('received')}
          className={`px-4 py-1.5 rounded-lg transition-colors ${
            activeTab === 'received' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Received Reviews ({receivedReviews.length})
        </button>
        <button
          onClick={() => setActiveTab('written')}
          className={`px-4 py-1.5 rounded-lg transition-colors ${
            activeTab === 'written' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Reviews Given ({writtenReviews.length})
        </button>
        <button
          onClick={() => setActiveTab('eligible')}
          className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'eligible' ? 'bg-white text-indigo-700 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>Pending Review ({eligibleExchanges.length})</span>
          {eligibleExchanges.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* Tab 1: Received Reviews */}
      {activeTab === 'received' && (
        <div className="space-y-4">
          {receivedReviews.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {receivedReviews.map(review => {
                const author = students.find(s => s.id === review.authorId);
                return (
                  <div
                    key={review.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={author?.name || 'Peer'} initials={author?.initials} size="sm" />
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">{author?.name || 'Anonymous Peer'}</h3>
                          <p className="text-[11px] text-slate-500">{author?.college}</p>
                        </div>
                      </div>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>

                    <div className="text-[11px] font-semibold text-indigo-600">
                      Topic: {review.skillName}
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed italic bg-slate-50 p-3 rounded-xl border border-slate-100">
                      "{review.comment}"
                    </p>

                    <div className="text-[10px] text-slate-400 text-right">
                      Verified exchange feedback
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Star}
              title="No Reviews Received Yet"
              description="Complete skill exchanges with peers to earn verified testimonials on your teaching ability."
              actionLabel="Go to Exchanges"
              onAction={() => navigate('/skill-exchanges')}
            />
          )}
        </div>
      )}

      {/* Tab 2: Reviews Given */}
      {activeTab === 'written' && (
        <div className="space-y-4">
          {writtenReviews.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {writtenReviews.map(review => {
                const target = students.find(s => s.id === review.targetStudentId);
                return (
                  <div
                    key={review.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={target?.name || 'Peer'} initials={target?.initials} size="sm" />
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">Reviewed {target?.name}</h3>
                          <p className="text-[11px] text-slate-500">{target?.department}</p>
                        </div>
                      </div>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed italic bg-slate-50 p-3 rounded-xl border border-slate-100">
                      "{review.comment}"
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No Reviews Submitted Yet"
              description="You have not authored any reviews yet. Check the Pending Review tab to review completed partnerships."
            />
          )}
        </div>
      )}

      {/* Tab 3: Completed Exchanges Eligible for Review */}
      {activeTab === 'eligible' && (
        <div className="space-y-4">
          {eligibleExchanges.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {eligibleExchanges.map(exchange => {
                const partnerId = exchange.proposerId === currentUser.id ? exchange.partnerId : exchange.proposerId;
                const partner = students.find(s => s.id === partnerId);
                if (!partner) return null;

                return (
                  <div
                    key={exchange.id}
                    className="bg-white rounded-2xl border border-amber-200/80 p-5 shadow-xs space-y-3 bg-amber-50/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={partner.name} initials={partner.initials} size="sm" />
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">{partner.name}</h3>
                          <p className="text-[11px] text-slate-500">{partner.college}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        Completed Exchange
                      </span>
                    </div>

                    <div className="text-xs text-slate-700">
                      <p>
                        You successfully finished exchanging skills with {partner.name.split(' ')[0]}. Share feedback to help build their profile reputation!
                      </p>
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={() => setReviewModalData({ exchange, partner })}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors shadow-xs"
                      >
                        <Star className="w-3.5 h-3.5" />
                        Write Review Now
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="All Completed Exchanges Reviewed!"
              description="You have provided reviews for all your finished skill exchanges. Keep learning with new partners!"
              actionLabel="View Active Exchanges"
              onAction={() => navigate('/skill-exchanges')}
            />
          )}
        </div>
      )}

      {/* Review Modal */}
      {reviewModalData && (
        <WriteReviewModal
          isOpen={true}
          onClose={() => setReviewModalData(null)}
          exchange={reviewModalData.exchange}
          partner={reviewModalData.partner}
        />
      )}
    </div>
  );
};
