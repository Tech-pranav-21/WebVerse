import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { Skill, SkillCategory, ProficiencyLevel, SkillPriority, SkillType } from '../../types';

interface AddSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  editSkillItem?: Skill | null;
  defaultType?: SkillType;
}

const CATEGORIES: SkillCategory[] = [
  'Programming',
  'Web Development',
  'Data Science',
  'Database Management',
  'UI/UX Design',
  'Computer Science',
  'Communication',
  'Career Development',
  'Other'
];

export const AddSkillModal: React.FC<AddSkillModalProps> = ({
  isOpen,
  onClose,
  editSkillItem,
  defaultType = 'offered'
}) => {
  const { addSkill, editSkill } = useApp();

  const [type, setType] = useState<SkillType>(defaultType);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<SkillCategory>('Programming');
  const [proficiency, setProficiency] = useState<ProficiencyLevel>('Intermediate');
  const [priority, setPriority] = useState<SkillPriority>('High');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (editSkillItem) {
      setType(editSkillItem.type);
      setName(editSkillItem.name);
      setCategory(editSkillItem.category);
      setProficiency(editSkillItem.proficiency);
      setPriority(editSkillItem.priority || 'Medium');
      setDescription(editSkillItem.description || '');
    } else {
      setType(defaultType);
      setName('');
      setCategory('Programming');
      setProficiency('Intermediate');
      setPriority('High');
      setDescription('');
    }
    setError('');
  }, [editSkillItem, defaultType, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Skill name is required.');
      return;
    }

    if (editSkillItem) {
      editSkill(editSkillItem.id, {
        name: name.trim(),
        category,
        proficiency,
        priority: type === 'wanted' ? priority : undefined,
        description: description.trim()
      });
    } else {
      addSkill({
        name: name.trim(),
        category,
        proficiency,
        type,
        priority: type === 'wanted' ? priority : undefined,
        description: description.trim()
      });
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editSkillItem ? 'Edit Skill' : 'Add a New Skill'}
      description="Keep your portfolio up-to-date to get the most accurate peer exchange matches."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
            {error}
          </div>
        )}

        {/* Type toggle (only when adding new) */}
        {!editSkillItem && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Portfolio Type
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setType('offered')}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  type === 'offered'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                I Can Teach (Offered)
              </button>
              <button
                type="button"
                onClick={() => setType('wanted')}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  type === 'wanted'
                    ? 'bg-white text-violet-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                I Want to Learn (Wanted)
              </button>
            </div>
          </div>
        )}

        {/* Skill Name */}
        <div>
          <label htmlFor="skill-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Skill / Topic Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="skill-name"
            type="text"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. React 19, PostgreSQL, Docker, Figma..."
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          />
        </div>

        {/* Category */}
        <div>
          <label htmlFor="skill-category" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Category
          </label>
          <select
            id="skill-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as SkillCategory)}
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          >
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Proficiency & Priority Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="skill-proficiency" className="block text-xs font-semibold text-slate-700 mb-1.5">
              {type === 'offered' ? 'Your Proficiency' : 'Target Proficiency'}
            </label>
            <select
              id="skill-proficiency"
              value={proficiency}
              onChange={(e) => setProficiency(e.target.value as ProficiencyLevel)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>

          {type === 'wanted' && (
            <div>
              <label htmlFor="skill-priority" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Learning Priority
              </label>
              <select
                id="skill-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as SkillPriority)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
              >
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="skill-description" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Brief Description / Scope (Optional)
          </label>
          <textarea
            id="skill-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Focus on practical projects, query optimization, or fundamentals..."
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

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
            {editSkillItem ? 'Save Changes' : 'Add Skill'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
