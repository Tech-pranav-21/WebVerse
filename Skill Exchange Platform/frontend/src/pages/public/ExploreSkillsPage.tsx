import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { StudentCard } from '../../components/common/StudentCard';
import { EmptyState } from '../../components/common/EmptyState';
import { calculateMatchScore } from '../../services/matching';
import { SkillCategory, ProficiencyLevel, LearningMethod } from '../../types';
import { Search, SlidersHorizontal, X, Compass, ArrowUpDown } from 'lucide-react';

const CATEGORIES: ('All' | SkillCategory)[] = [
  'All',
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

export const ExploreSkillsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { students, currentUser } = useApp();

  const initialCat = (searchParams.get('category') as SkillCategory) || 'All';

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState<'All' | SkillCategory>(initialCat);
  const [levelFilter, setLevelFilter] = useState<'All' | ProficiencyLevel>('All');
  const [methodFilter, setMethodFilter] = useState<'All' | LearningMethod>('All');
  const [sortBy, setSortBy] = useState<'relevance' | 'rating' | 'alphabetical' | 'skillsCount'>('relevance');

  // Sync category from URL param if changed externally
  useEffect(() => {
    const cat = searchParams.get('category') as SkillCategory | null;
    if (cat && CATEGORIES.includes(cat)) {
      setSelectedCategory(cat);
    }
  }, [searchParams]);

  const handleCategoryClick = (cat: 'All' | SkillCategory) => {
    setSelectedCategory(cat);
    const newParams = new URLSearchParams(searchParams);
    if (cat === 'All') {
      newParams.delete('category');
    } else {
      newParams.set('category', cat);
    }
    setSearchParams(newParams);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setLevelFilter('All');
    setMethodFilter('All');
    setSortBy('relevance');
    setSearchParams(new URLSearchParams());
  };

  const isFiltered = 
    searchQuery.trim() !== '' || 
    selectedCategory !== 'All' || 
    levelFilter !== 'All' || 
    methodFilter !== 'All';

  // Filter and sort students
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      // 1. Text Search Query (Skill name, Student name, College, Department)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = student.name.toLowerCase().includes(query);
        const matchesCollege = student.college.toLowerCase().includes(query);
        const matchesDepartment = student.department.toLowerCase().includes(query);
        const matchesSkillsOffered = student.skillsOffered.some(s => s.name.toLowerCase().includes(query));
        const matchesSkillsWanted = student.skillsWanted.some(s => s.name.toLowerCase().includes(query));

        if (!matchesName && !matchesCollege && !matchesDepartment && !matchesSkillsOffered && !matchesSkillsWanted) {
          return false;
        }
      }

      // 2. Category Filter
      if (selectedCategory !== 'All') {
        const hasSkillInCat = student.skillsOffered.some(s => s.category === selectedCategory);
        if (!hasSkillInCat) return false;
      }

      // 3. Level Filter
      if (levelFilter !== 'All') {
        const hasSkillWithLevel = student.skillsOffered.some(s => s.proficiency === levelFilter);
        if (!hasSkillWithLevel) return false;
      }

      // 4. Learning Method Filter
      if (methodFilter !== 'All') {
        if (student.preferredMethod !== 'Flexible' && student.preferredMethod !== methodFilter) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'rating') {
        return b.rating - a.rating;
      }
      if (sortBy === 'alphabetical') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'skillsCount') {
        return b.skillsOffered.length - a.skillsOffered.length;
      }
      // Default: relevance (matching score if user logged in, else rating)
      if (currentUser) {
        const matchA = calculateMatchScore(currentUser, a).score;
        const matchB = calculateMatchScore(currentUser, b).score;
        return matchB - matchA;
      }
      return b.rating - a.rating;
    });
  }, [students, currentUser, searchQuery, selectedCategory, levelFilter, methodFilter, sortBy]);

  return (
    <div className="space-y-6">
      {/* Header and Search Box */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Explore Skills & Learning Partners
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Discover students offering knowledge across {students.length} active peer profiles.
            </p>
          </div>

          {/* Quick Clear */}
          {isFiltered && (
            <button
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors self-start md:self-center"
            >
              <X className="w-3.5 h-3.5" />
              Reset all filters
            </button>
          )}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by skill (e.g. React, Java, Figma, Python), student name, college, or major..."
            className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Interactive Category Filter Pills */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {CATEGORIES.map(cat => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Additional Filters & Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Level Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Proficiency:</span>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as 'All' | ProficiencyLevel)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="All">All Levels</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>

            {/* Method Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Format:</span>
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value as 'All' | LearningMethod)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="All">All Formats</option>
                <option value="Online">Online</option>
                <option value="In-person">In-person</option>
                <option value="Flexible">Flexible</option>
              </select>
            </div>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Sort By:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="relevance">Relevance & Match</option>
              <option value="rating">Highest Rating</option>
              <option value="skillsCount">Most Skills Offered</option>
              <option value="alphabetical">Alphabetical (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>
          Showing <strong className="text-slate-800 tabular-nums">{filteredStudents.length}</strong> {filteredStudents.length === 1 ? 'student' : 'students'}
          {selectedCategory !== 'All' && <span> in <strong>{selectedCategory}</strong></span>}
          {searchQuery && <span> matching "<strong>{searchQuery}</strong>"</span>}
        </span>
        {currentUser && (
          <span className="text-indigo-600 font-medium">
            Match scores calculated against your profile
          </span>
        )}
      </div>

      {/* Student Cards Grid or Empty State */}
      {filteredStudents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredStudents.map(student => {
            const matchResult = currentUser && currentUser.id !== student.id 
              ? calculateMatchScore(currentUser, student) 
              : undefined;

            return (
              <StudentCard
                key={student.id}
                student={student}
                matchResult={matchResult}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Compass}
          title="No Students Found Matching Your Search"
          description="Try broadening your search term or resetting category and format filters to view available learning partners."
          actionLabel="Reset Filters"
          onAction={handleClearFilters}
        />
      )}
    </div>
  );
};
