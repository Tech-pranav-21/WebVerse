import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { RatingStars } from '../common/RatingStars';
import { SkillExchange, Student } from '../../types';

interface WriteReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  exchange: SkillExchange;
  partner: Student;
}

export const WriteReviewModal: React.FC<WriteReviewModalProps> = ({
  isOpen,
  onClose,
  exchange,
  partner
}) => {
  const { currentUser, submitReview } = useApp();

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const isCurrentUserProposer = exchange.proposerId === currentUser?.id;
  // If current user proposed, the skill they learned from partner is learnSkillName
  const reviewedSkill = isCurrentUserProposer ? exchange.learnSkillName : exchange.teachSkillName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) {
      setError('Please provide feedback about your learning experience.');
      return;
    }
    if (rating < 1 || rating > 5) {
      setError('Please select a star rating from 1 to 5.');
      return;
    }

    const success = submitReview(exchange.id, partner.id, rating, comment.trim(), reviewedSkill);
    if (success) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Review Learning Partner: ${partner.name}`}
      description="Help fellow students by providing constructive, supportive feedback on your completed exchange."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
            {error}
          </div>
        )}

        {/* Exchange summary badge */}
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
          <div className="text-slate-500 mb-0.5">Completed Skill Exchange:</div>
          <div className="font-semibold text-slate-900">{reviewedSkill}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Exchange #{exchange.id} · Completed
          </div>
        </div>

        {/* Interactive Star Rating */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            Overall Rating <span className="text-rose-500">*</span>
          </label>
          <div className="flex items-center gap-3">
            <RatingStars
              rating={rating}
              size="lg"
              interactive
              onChange={(newVal) => setRating(newVal)}
            />
            <span className="text-sm font-bold text-slate-800 tabular-nums">
              {rating} / 5
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Click any star to set your rating.
          </p>
        </div>

        {/* Review Comment */}
        <div>
          <label htmlFor="review-comment" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Feedback & Testimonial <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="review-comment"
            required
            rows={4}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (error) setError('');
            }}
            placeholder="What was most helpful? Was your partner punctual, patient, and prepared? Share specific takeaways..."
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

        {/* Notice */}
        <p className="text-[11px] text-slate-400 italic">
          Note: This is simulated demo feedback stored in local state.
        </p>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
          >
            Submit Review
          </button>
        </div>
      </form>
    </Modal>
  );
};
