import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { Student } from '../../types';
import { Repeat } from 'lucide-react';

interface ProposeExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedPartner?: Student | null;
}

export const ProposeExchangeModal: React.FC<ProposeExchangeModalProps> = ({
  isOpen,
  onClose,
  preselectedPartner
}) => {
  const { currentUser, students, proposeExchange } = useApp();

  const [partnerId, setPartnerId] = useState('');
  const [teachSkillName, setTeachSkillName] = useState('');
  const [learnSkillName, setLearnSkillName] = useState('');
  const [proposedSchedule, setProposedSchedule] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  // Potential partner candidates (all students except current user)
  const availablePartners = students.filter(s => s.id !== currentUser?.id);

  useEffect(() => {
    if (preselectedPartner) {
      setPartnerId(preselectedPartner.id);
      if (preselectedPartner.skillsOffered.length > 0) {
        setLearnSkillName(preselectedPartner.skillsOffered[0].name);
      }
    } else if (availablePartners.length > 0) {
      setPartnerId(availablePartners[0].id);
      if (availablePartners[0].skillsOffered.length > 0) {
        setLearnSkillName(availablePartners[0].skillsOffered[0].name);
      }
    }

    if (currentUser && currentUser.skillsOffered.length > 0) {
      setTeachSkillName(currentUser.skillsOffered[0].name);
    }

    setProposedSchedule('Weekly, 1 hour (Flexible evening)');
    setDescription('Looking forward to trading skills! 30 mins each per session.');
    setError('');
  }, [preselectedPartner, currentUser, isOpen]);

  const selectedPartner = students.find(s => s.id === partnerId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) {
      setError('Please select a learning partner.');
      return;
    }
    if (!teachSkillName.trim()) {
      setError('Please specify the skill you will teach.');
      return;
    }
    if (!learnSkillName.trim()) {
      setError('Please specify the skill you want to learn.');
      return;
    }

    proposeExchange({
      partnerId,
      teachSkillName: teachSkillName.trim(),
      learnSkillName: learnSkillName.trim(),
      description: description.trim() || 'Collaborative peer skill exchange.',
      proposedSchedule: proposedSchedule.trim() || 'Flexible mutually agreed times.'
    });

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Propose a Skill Exchange"
      description="Set up a two-way collaborative learning partnership where both peers teach and learn."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
            {error}
          </div>
        )}

        {/* Partner Select */}
        <div>
          <label htmlFor="exchange-partner" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Learning Partner <span className="text-rose-500">*</span>
          </label>
          <select
            id="exchange-partner"
            value={partnerId}
            onChange={(e) => {
              setPartnerId(e.target.value);
              const partner = students.find(s => s.id === e.target.value);
              if (partner && partner.skillsOffered.length > 0) {
                setLearnSkillName(partner.skillsOffered[0].name);
              }
            }}
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          >
            {availablePartners.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.department} · {p.college})
              </option>
            ))}
          </select>
        </div>

        {/* Skills exchange row */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Repeat className="w-4 h-4 text-indigo-600" />
            Exchange Matchup
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Skill I will teach */}
            <div>
              <label htmlFor="teach-skill-select" className="block text-xs font-medium text-slate-600 mb-1">
                Skill You Will Teach:
              </label>
              {currentUser && currentUser.skillsOffered.length > 0 ? (
                <select
                  id="teach-skill-select"
                  value={teachSkillName}
                  onChange={(e) => setTeachSkillName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500"
                >
                  {currentUser.skillsOffered.map(s => (
                    <option key={s.id} value={s.name}>{s.name} ({s.proficiency})</option>
                  ))}
                  <option value="__custom">Custom topic...</option>
                </select>
              ) : (
                <input
                  id="teach-skill-input"
                  type="text"
                  placeholder="e.g. Java Basics"
                  value={teachSkillName}
                  onChange={(e) => setTeachSkillName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500"
                />
              )}
            </div>

            {/* Skill I will learn */}
            <div>
              <label htmlFor="learn-skill-select" className="block text-xs font-medium text-slate-600 mb-1">
                Skill You Want To Learn:
              </label>
              {selectedPartner && selectedPartner.skillsOffered.length > 0 ? (
                <select
                  id="learn-skill-select"
                  value={learnSkillName}
                  onChange={(e) => setLearnSkillName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500"
                >
                  {selectedPartner.skillsOffered.map(s => (
                    <option key={s.id} value={s.name}>{s.name} ({s.proficiency})</option>
                  ))}
                  <option value="__custom">Custom topic...</option>
                </select>
              ) : (
                <input
                  id="learn-skill-input"
                  type="text"
                  placeholder="e.g. React 19 State"
                  value={learnSkillName}
                  onChange={(e) => setLearnSkillName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-500"
                />
              )}
            </div>
          </div>
        </div>

        {/* Proposed Schedule */}
        <div>
          <label htmlFor="exchange-schedule" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Proposed Schedule Cadence
          </label>
          <input
            id="exchange-schedule"
            type="text"
            value={proposedSchedule}
            onChange={(e) => setProposedSchedule(e.target.value)}
            placeholder="e.g. Tuesdays & Thursdays at 6:00 PM PST (1 hour)"
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          />
        </div>

        {/* Description / Goals */}
        <div>
          <label htmlFor="exchange-description" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Goals & Notes
          </label>
          <textarea
            id="exchange-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what you hope to achieve and how you would like to structure your study sessions..."
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

        {/* Action Buttons */}
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
            Send Proposal
          </button>
        </div>
      </form>
    </Modal>
  );
};
