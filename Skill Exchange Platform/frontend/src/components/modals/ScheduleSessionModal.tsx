import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { LearningSession, LearningMethod, Student } from '../../types';

interface ScheduleSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editSessionItem?: LearningSession | null;
  preselectedPartner?: Student | null;
}

export const ScheduleSessionModal: React.FC<ScheduleSessionModalProps> = ({
  isOpen,
  onClose,
  editSessionItem,
  preselectedPartner
}) => {
  const { currentUser, students, scheduleSession, editSession } = useApp();

  const [partnerId, setPartnerId] = useState('');
  const [skillName, setSkillName] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [learningMethod, setLearningMethod] = useState<LearningMethod>('Online');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // Minimum allowed date is today's local date
  const todayString = new Date().toISOString().split('T')[0];

  const availablePartners = students.filter(s => s.id !== currentUser?.id);

  useEffect(() => {
    if (editSessionItem) {
      setPartnerId(editSessionItem.partnerId);
      setSkillName(editSessionItem.skillName);
      setDate(editSessionItem.date);
      setStartTime(editSessionItem.startTime);
      setDurationMinutes(editSessionItem.durationMinutes);
      setLearningMethod(editSessionItem.learningMethod);
      setNotes(editSessionItem.notes || '');
    } else {
      if (preselectedPartner) {
        setPartnerId(preselectedPartner.id);
        if (preselectedPartner.skillsOffered.length > 0) {
          setSkillName(preselectedPartner.skillsOffered[0].name);
        }
      } else if (availablePartners.length > 0) {
        setPartnerId(availablePartners[0].id);
        if (availablePartners[0].skillsOffered.length > 0) {
          setSkillName(availablePartners[0].skillsOffered[0].name);
        }
      }
      // Tomorrow as default date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setDate(tomorrow.toISOString().split('T')[0]);
      setStartTime('17:00');
      setDurationMinutes(60);
      setLearningMethod('Online');
      setNotes('');
    }
    setError('');
  }, [editSessionItem, preselectedPartner, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) {
      setError('Please select a learning partner.');
      return;
    }
    if (!skillName.trim()) {
      setError('Please specify the skill or topic for this session.');
      return;
    }
    if (!date) {
      setError('Please choose a session date.');
      return;
    }
    // Prevent dates in the past
    if (date < todayString) {
      setError('Cannot schedule learning sessions in the past. Please select today or a future date.');
      return;
    }

    if (editSessionItem) {
      editSession(editSessionItem.id, {
        partnerId,
        skillName: skillName.trim(),
        date,
        startTime,
        durationMinutes,
        learningMethod,
        notes: notes.trim()
      });
    } else {
      scheduleSession({
        partnerId,
        skillName: skillName.trim(),
        date,
        startTime,
        durationMinutes,
        learningMethod,
        notes: notes.trim()
      });
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editSessionItem ? 'Reschedule / Edit Session' : 'Schedule a Learning Session'}
      description="Plan focused time with your peer learning partner to practice skills together."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
            {error}
          </div>
        )}

        {/* Partner */}
        <div>
          <label htmlFor="session-partner" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Learning Partner <span className="text-rose-500">*</span>
          </label>
          <select
            id="session-partner"
            value={partnerId}
            onChange={(e) => {
              setPartnerId(e.target.value);
              const p = students.find(s => s.id === e.target.value);
              if (p && p.skillsOffered.length > 0) {
                setSkillName(p.skillsOffered[0].name);
              }
            }}
            disabled={!!editSessionItem}
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white disabled:bg-slate-50"
          >
            {availablePartners.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.department})
              </option>
            ))}
          </select>
        </div>

        {/* Skill / Topic */}
        <div>
          <label htmlFor="session-skill" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Skill / Topic to Practice <span className="text-rose-500">*</span>
          </label>
          <input
            id="session-skill"
            type="text"
            required
            value={skillName}
            onChange={(e) => setSkillName(e.target.value)}
            placeholder="e.g. React Custom Hooks or SQL Joins"
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          />
        </div>

        {/* Date & Time Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="session-date" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Date <span className="text-rose-500">*</span>
            </label>
            <input
              id="session-date"
              type="date"
              required
              min={todayString}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (error) setError('');
              }}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
          </div>

          <div>
            <label htmlFor="session-time" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Start Time
            </label>
            <input
              id="session-time"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
          </div>
        </div>

        {/* Duration & Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="session-duration" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Duration
            </label>
            <select
              id="session-duration"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            >
              <option value={30}>30 Minutes</option>
              <option value={45}>45 Minutes</option>
              <option value={60}>60 Minutes (Recommended)</option>
              <option value={90}>90 Minutes</option>
              <option value={120}>120 Minutes</option>
            </select>
          </div>

          <div>
            <label htmlFor="session-method" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Format
            </label>
            <select
              id="session-method"
              value={learningMethod}
              onChange={(e) => setLearningMethod(e.target.value as LearningMethod)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            >
              <option value="Online">Online Video / Screen Share</option>
              <option value="In-person">In-person Campus Meet</option>
              <option value="Flexible">Flexible / Hybrid</option>
            </select>
          </div>
        </div>

        {/* Agenda / Notes */}
        <div>
          <label htmlFor="session-notes" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Session Agenda & Goals (Optional)
          </label>
          <textarea
            id="session-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Review code from last week, practice dynamic programming problem set..."
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

        {/* Footer buttons */}
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
            {editSessionItem ? 'Update Session' : 'Schedule Session'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
