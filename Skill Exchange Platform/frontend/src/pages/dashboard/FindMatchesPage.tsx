import React, { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { calculateMatchScore } from '../../services/matching';
import { StudentCard } from '../../components/common/StudentCard';
import { EmptyState } from '../../components/common/EmptyState';
import { Student } from '../../types';
import { 
  Sparkles, 
  HelpCircle, 
  Info, 
  Filter, 
  CheckCircle2, 
  Repeat, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';

export const FindMatchesPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, students } = useApp();
  const { onOpenProposeExchange } = useOutletContext<{ onOpenProposeExchange: (student: Student) => void }>();

  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'reciprocal' | 'teachMe'>('all');

  if (!currentUser) return null;

  // Calculate matches for all other students
  const matchResults = useMemo(() => {
    return students
      .filter(s => s.id !== currentUser.id)
      .map(candidate => calculateMatchScore(currentUser, candidate))
      .sort((a, b) => b.score - a.score);
  }, [students, currentUser]);

  const filteredMatches = useMemo(() => {
    if (filterType === 'reciprocal') {
      return matchResults.filter(m => m.isReciprocal);
    }
    if (filterType === 'teachMe') {
      return matchResults.filter(m => m.canTeachMe.length > 0);
    }
    return matchResults;
  }, [matchResults, filterType]);

  const reciprocalCount = matchResults.filter(m => m.isReciprocal).length;

  return (
    <div className="space-y-6">
      {/* Top Banner with Formula Info */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/70 px-2.5 py-1 rounded-md">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Algorithmic Peer Matching</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Complementary Skill Matches
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-2xl">
              We compare your wanted skills against peer offerings, and highlight reciprocal opportunities where you both can learn and teach.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFormulaModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors shrink-0"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" />
            <span>How Score Is Calculated</span>
          </button>
        </div>

        {/* User Skills Summary Bar */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div>
            <span className="font-semibold text-slate-500 block mb-1">Your Teaching Offerings:</span>
            <div className="flex flex-wrap gap-1 text-slate-700">
              {currentUser.skillsOffered.map(s => (
                <span key={s.id} className="bg-white border border-slate-200 px-2 py-0.5 rounded font-medium">
                  {s.name}
                </span>
              ))}
            </div>
          </div>
          <div>
            <span className="font-semibold text-slate-500 block mb-1">Your Learning Goals:</span>
            <div className="flex flex-wrap gap-1 text-violet-700">
              {currentUser.skillsWanted.map(s => (
                <span key={s.id} className="bg-white border border-violet-200 px-2 py-0.5 rounded font-medium">
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Filter:</span>
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
                filterType === 'all'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Potential Matches ({matchResults.length})
            </button>
            <button
              onClick={() => setFilterType('reciprocal')}
              className={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
                filterType === 'reciprocal'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Direct Reciprocal ({reciprocalCount})
            </button>
            <button
              onClick={() => setFilterType('teachMe')}
              className={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
                filterType === 'teachMe'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Can Teach Me
            </button>
          </div>

          <span className="text-slate-500">
            Sorted by highest compatibility score
          </span>
        </div>
      </div>

      {/* Matches Grid */}
      {filteredMatches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMatches.map(res => (
            <StudentCard
              key={res.student.id}
              student={res.student}
              matchResult={res}
              onProposeExchange={onOpenProposeExchange}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No Matching Students in This Category"
          description="Try switching the filter to view all students or add more learning goals in My Skills."
          actionLabel="View All Matches"
          onAction={() => setFilterType('all')}
        />
      )}

      {/* Formula Explanation Modal */}
      <Modal
        isOpen={formulaModalOpen}
        onClose={() => setFormulaModalOpen(false)}
        title="Documented Matching Algorithm"
        description="SkillBridge uses a deterministic, rule-based algorithm to ensure complete transparency."
        maxWidth="md"
      >
        <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-900 space-y-1">
            <p className="font-semibold">Transparent Deterministic Formula (100 Point Scale):</p>
            <p className="text-[11px] text-indigo-700">
              No black-box or generative AI is used for pairing. Matches are calculated directly from skill keywords, availability windows, and preferred learning formats.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-800 flex items-center justify-center shrink-0">1</span>
              <div>
                <strong className="text-slate-900">Teaching Match (Up to 50%):</strong>
                <p>Candidate teaches what you want to learn. 40 points for 1 matching skill, 50 points for 2+ matching skills.</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-800 flex items-center justify-center shrink-0">2</span>
              <div>
                <strong className="text-slate-900">Reciprocal Teach Bonus (Up to 30%):</strong>
                <p>You teach what the candidate wants to learn in return. 25 points for 1 matching skill, 30 points for 2+ skills.</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-800 flex items-center justify-center shrink-0">3</span>
              <div>
                <strong className="text-slate-900">Learning Format Compatibility (Up to 10%):</strong>
                <p>10 points if either peer is flexible or both prefer the same format (Online or In-person); 5 points otherwise.</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-800 flex items-center justify-center shrink-0">4</span>
              <div>
                <strong className="text-slate-900">Schedule Overlap (Up to 10%):</strong>
                <p>10 points if shared availability tags exist (e.g. Evenings, Weekends); 5 points otherwise.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              onClick={() => setFormulaModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              Understood
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
