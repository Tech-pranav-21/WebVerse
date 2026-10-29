import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Skill, SkillType } from '../../types';
import { SkillBadge } from '../../components/common/SkillBadge';
import { AddSkillModal } from '../../components/modals/AddSkillModal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { EmptyState } from '../../components/common/EmptyState';
import { 
  Plus, 
  Edit3, 
  Trash2, 
  BookOpen, 
  TrendingUp, 
  Sparkles, 
  AlertCircle 
} from 'lucide-react';

export const MySkillsPage: React.FC = () => {
  const { currentUser, deleteSkill } = useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<SkillType>('offered');
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'offered' | 'wanted'>('all');

  if (!currentUser) return null;

  const handleOpenAdd = (type: SkillType) => {
    setEditingSkill(null);
    setModalType(type);
    setModalOpen(true);
  };

  const handleOpenEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setModalType(skill.type);
    setModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (confirmDeleteId) {
      deleteSkill(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            My Skills Portfolio
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Maintain accurate skills you offer and subjects you want to explore. Changes immediately update your peer matching compatibility.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenAdd('offered')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Teaching Skill
          </button>
          <button
            type="button"
            onClick={() => handleOpenAdd('wanted')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-xl transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Learning Goal
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit text-xs font-medium">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-1.5 rounded-lg transition-colors ${
            activeTab === 'all' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All Skills ({currentUser.skillsOffered.length + currentUser.skillsWanted.length})
        </button>
        <button
          onClick={() => setActiveTab('offered')}
          className={`px-4 py-1.5 rounded-lg transition-colors ${
            activeTab === 'offered' ? 'bg-white text-indigo-700 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Skills I Can Teach ({currentUser.skillsOffered.length})
        </button>
        <button
          onClick={() => setActiveTab('wanted')}
          className={`px-4 py-1.5 rounded-lg transition-colors ${
            activeTab === 'wanted' ? 'bg-white text-violet-700 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Skills I Want to Learn ({currentUser.skillsWanted.length})
        </button>
      </div>

      {/* SECTION 1: Skills I Can Teach */}
      {(activeTab === 'all' || activeTab === 'offered') && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                <BookOpen className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                Skills I Can Teach ({currentUser.skillsOffered.length})
              </h2>
            </div>
            <button
              onClick={() => handleOpenAdd('offered')}
              className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add skill
            </button>
          </div>

          {currentUser.skillsOffered.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentUser.skillsOffered.map((skill) => (
                <div
                  key={skill.id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-900 leading-snug">
                        {skill.name}
                      </h3>
                      <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md shrink-0">
                        {skill.proficiency}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-medium">
                      Category: <span className="text-slate-700">{skill.category}</span>
                    </div>

                    {skill.description ? (
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                        {skill.description}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No notes provided.</p>
                    )}
                  </div>

                  <div className="pt-3 mt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(skill)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-50 transition-colors"
                      title="Edit Skill"
                      aria-label="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(skill.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete Skill"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No Teaching Skills Listed"
              description="Add programming languages, design tools, or concepts you are confident in to start matching with peers."
              actionLabel="Add Teaching Skill"
              onAction={() => handleOpenAdd('offered')}
            />
          )}
        </section>
      )}

      {/* SECTION 2: Skills I Want to Learn */}
      {(activeTab === 'all' || activeTab === 'wanted') && (
        <section className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-violet-50 text-violet-700">
                <TrendingUp className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                Skills I Want to Learn ({currentUser.skillsWanted.length})
              </h2>
            </div>
            <button
              onClick={() => handleOpenAdd('wanted')}
              className="text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add learning goal
            </button>
          </div>

          {currentUser.skillsWanted.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentUser.skillsWanted.map((skill) => (
                <div
                  key={skill.id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-violet-300 transition-colors"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-900 leading-snug">
                        {skill.name}
                      </h3>
                      {skill.priority && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 border ${
                          skill.priority === 'High' 
                            ? 'bg-rose-50 text-rose-700 border-rose-200' 
                            : skill.priority === 'Medium'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}>
                          {skill.priority} Priority
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 font-medium">
                      Category: <span className="text-slate-700">{skill.category}</span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-medium">
                      Target Level: <span className="text-slate-700">{skill.proficiency}</span>
                    </div>

                    {skill.description ? (
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                        {skill.description}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No notes provided.</p>
                    )}
                  </div>

                  <div className="pt-3 mt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(skill)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-violet-600 hover:bg-slate-50 transition-colors"
                      title="Edit Skill"
                      aria-label="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(skill.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete Skill"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No Learning Goals Added Yet"
              description="Add the tools, languages, or concepts you want to learn to get matched with knowledgeable peers."
              actionLabel="Add Learning Goal"
              onAction={() => handleOpenAdd('wanted')}
            />
          )}
        </section>
      )}

      {/* Add / Edit Skill Modal */}
      <AddSkillModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingSkill(null);
        }}
        editSkillItem={editingSkill}
        defaultType={modalType}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
        title="Remove Skill"
        message="Are you sure you want to remove this skill from your profile? This will recalculate your peer match scores."
        confirmLabel="Remove Skill"
        variant="danger"
      />
    </div>
  );
};
