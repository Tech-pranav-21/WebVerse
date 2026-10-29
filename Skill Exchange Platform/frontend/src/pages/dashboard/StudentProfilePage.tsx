import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Avatar } from '../../components/common/Avatar';
import { SkillBadge } from '../../components/common/SkillBadge';
import { RatingStars } from '../../components/common/RatingStars';
import { EditProfileModal } from '../../components/modals/EditProfileModal';
import { ProposeExchangeModal } from '../../components/modals/ProposeExchangeModal';
import { ReportProfileModal } from '../../components/modals/ReportProfileModal';
import { TipStudentModal } from '../../components/modals/TipStudentModal';
import { 
  MapPin, 
  BookOpen, 
  TrendingUp, 
  Calendar, 
  Globe, 
  Send, 
  MessageSquare, 
  Repeat, 
  Bookmark, 
  ShieldAlert, 
  Edit3, 
  CheckCircle2, 
  Clock, 
  Star,
  ArrowLeft,
  Heart,
  DollarSign
} from 'lucide-react';

export const StudentProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { 
    currentUser, 
    students, 
    reviews, 
    getConnectionWith, 
    sendConnectionRequest, 
    savedProfileIds, 
    toggleSaveProfile,
    bookPaidSession
  } = useApp();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [proposeModalOpen, setProposeModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [tipModalOpen, setTipModalOpen] = useState(false);

  // Find student by ID (fallback to currentUser if id matches or empty)
  const student = useMemo(() => {
    if (!id || id === currentUser?.id) return currentUser;
    return students.find(s => s.id === id) || null;
  }, [id, currentUser, students]);

  if (!student) {
    return (
      <div className="text-center py-16 space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Student Profile Not Found</h2>
        <p className="text-xs text-slate-500">The requested student ID does not exist in local demo records.</p>
        <button
          onClick={() => navigate('/explore')}
          className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg"
        >
          Back to Directory
        </button>
      </div>
    );
  }

  const isSelf = currentUser?.id === student.id;
  const connection = getConnectionWith(student.id);
  const isSaved = savedProfileIds.includes(student.id);

  // Student reviews
  const studentReviews = reviews.filter(r => r.targetStudentId === student.id);

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to previous page
        </button>
      </div>

      {/* Main Profile Header Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
            <Avatar name={student.name} initials={student.initials} size="xl" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{student.name}</h1>
                {isSelf && (
                  <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-md">
                    Your Profile
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm font-medium text-slate-600">
                {student.department} · {student.yearOfStudy}
              </p>
              <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-slate-500 pt-0.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>{student.college}</span>
              </div>
              <div className="pt-2 flex items-center justify-center sm:justify-start gap-2">
                <RatingStars
                  rating={student.rating}
                  size="sm"
                  showNumber
                  reviewCount={student.reviewCount}
                />
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-500">
                  {student.completedExchangesCount} completed exchanges
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2.5">
            {isSelf ? (
              <button
                onClick={() => setEditModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors shadow-xs"
              >
                <Edit3 className="w-4 h-4" />
                Edit Profile
              </button>
            ) : (
              <>
                <button
                  onClick={() => toggleSaveProfile(student.id)}
                  className={`p-2 rounded-xl border transition-colors ${
                    isSaved
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                  title={isSaved ? 'Bookmarked' : 'Bookmark Profile'}
                  aria-label="Bookmark"
                >
                  <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-indigo-600' : ''}`} />
                </button>

                {connection?.status === 'Accepted' ? (
                  <button
                    onClick={() => navigate(`/messages?student=${student.id}`)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    <MessageSquare className="w-4 h-4 text-slate-600" />
                    Message
                  </button>
                ) : connection?.status === 'Pending' ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
                    <Clock className="w-4 h-4 text-amber-600" />
                    Request Pending
                  </span>
                ) : (
                  <button
                    onClick={() => sendConnectionRequest(student.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors"
                  >
                    <Send className="w-4 h-4 text-indigo-600" />
                    Connect
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setTipModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors shadow-2xs"
                  title="Send peer recognition tip"
                >
                  <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                  <span>Send Tip</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    bookPaidSession({
                      partner: student,
                      skillName: student.skillsOffered[0]?.name || 'Peer Mentorship',
                      amount: 15.00,
                      date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
                      startTime: '18:00',
                      durationMinutes: 60,
                      learningMethod: student.preferredMethod || 'Online',
                      notes: 'Priority 1-on-1 mentorship session.'
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors shadow-2xs"
                  title="Book priority 1-on-1 consultation"
                >
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Book 1-on-1 ($15)</span>
                </button>

                <button
                  onClick={() => setProposeModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
                >
                  <Repeat className="w-4 h-4" />
                  Propose Exchange
                </button>

                <button
                  onClick={() => setReportModalOpen(true)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                  title="Report Profile"
                  aria-label="Report"
                >
                  <ShieldAlert className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Bio */}
        <div className="pt-4 border-t border-slate-100">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            About
          </h2>
          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
            {student.bio}
          </p>
        </div>

        {/* Logistics strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-100 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Format</span>
            <span className="font-semibold text-slate-800">{student.preferredMethod} Sessions</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Availability</span>
            <span className="font-semibold text-slate-800 truncate block">
              {student.availability.join(', ')}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Languages</span>
            <span className="font-semibold text-slate-800 truncate block">
              {student.languages.join(', ')}
            </span>
          </div>
        </div>
      </div>

      {/* Skills Sections Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Skills Offered */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <BookOpen className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">
              Skills {student.name.split(' ')[0]} Can Teach ({student.skillsOffered.length})
            </h2>
          </div>

          <div className="space-y-3">
            {student.skillsOffered.map(skill => (
              <div key={skill.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{skill.name}</span>
                  <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                    {skill.proficiency}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">Category: {skill.category}</p>
                {skill.description && (
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {skill.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Skills Wanted */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-violet-50 text-violet-700">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">
              Skills {student.name.split(' ')[0]} Wants to Learn ({student.skillsWanted.length})
            </h2>
          </div>

          <div className="space-y-3">
            {student.skillsWanted.map(skill => (
              <div key={skill.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{skill.name}</span>
                  {skill.priority && (
                    <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">
                      {skill.priority} Priority
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 font-medium">Category: {skill.category}</p>
                {skill.description && (
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {skill.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reviews Received Section */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            Peer Reviews ({studentReviews.length})
          </h2>
          <span className="text-xs text-slate-500">Verified exchange testimonials</span>
        </div>

        {studentReviews.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {studentReviews.map(r => {
              const reviewer = students.find(s => s.id === r.authorId);
              return (
                <div key={r.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/40 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{reviewer?.name || 'Peer'}</span>
                    <RatingStars rating={r.rating} size="sm" />
                  </div>
                  <p className="text-slate-600 italic">"{r.comment}"</p>
                  <span className="text-[10px] text-slate-400 block pt-1">Topic: {r.skillName}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-4 text-center">
            No peer reviews recorded for this student yet.
          </p>
        )}
      </div>

      {/* Modals */}
      <EditProfileModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
      />

      <ProposeExchangeModal
        isOpen={proposeModalOpen}
        onClose={() => setProposeModalOpen(false)}
        preselectedPartner={student}
      />

      <ReportProfileModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetStudent={student}
      />

      <TipStudentModal
        isOpen={tipModalOpen}
        onClose={() => setTipModalOpen(false)}
        student={student}
      />
    </div>
  );
};
