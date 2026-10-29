import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { Student } from '../../types';
import { ShieldAlert } from 'lucide-react';

interface ReportProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetStudent: Student;
}

const REPORT_REASONS = [
  'Inappropriate or offensive bio/content',
  'Commercial solicitation or spamming',
  'False or misleading skill proficiency claims',
  'Unresponsive or repeated missed sessions',
  'Other policy concern'
];

export const ReportProfileModal: React.FC<ReportProfileModalProps> = ({
  isOpen,
  onClose,
  targetStudent
}) => {
  const { reportProfile } = useApp();

  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    reportProfile(targetStudent.id, reason, details.trim());
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Report Student Profile"
      description="Help maintain a supportive and respectful academic learning environment."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-800 text-xs">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p>
            You are reporting <strong>{targetStudent.name}</strong>. Reports in this demo environment are logged to local storage for testing purposes.
          </p>
        </div>

        <div>
          <label htmlFor="report-reason" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Reason for Report
          </label>
          <select
            id="report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          >
            {REPORT_REASONS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="report-details" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Additional Details (Optional)
          </label>
          <textarea
            id="report-details"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Please provide any relevant context..."
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

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
            className="px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors shadow-xs"
          >
            Submit Report
          </button>
        </div>
      </form>
    </Modal>
  );
};
