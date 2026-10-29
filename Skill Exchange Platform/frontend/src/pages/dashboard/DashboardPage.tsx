import React, { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { calculateMatchScore } from '../../services/matching';
import { StudentCard } from '../../components/common/StudentCard';
import { Avatar } from '../../components/common/Avatar';
import { EmptyState } from '../../components/common/EmptyState';
import { 
  BookOpen, 
  Repeat, 
  CheckCircle2, 
  Calendar, 
  Sparkles, 
  ArrowRight, 
  Clock, 
  Check, 
  X, 
  UserPlus, 
  TrendingUp,
  Award,
  Wallet
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    students, 
    exchanges, 
    connections, 
    sessions, 
    respondConnectionRequest,
    achievements,
    walletBalance,
    subscription
  } = useApp();

  if (!currentUser) return null;

  // Time-of-day greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // 1. Statistics Cards
  const stats = useMemo(() => {
    const skillsOfferedCount = currentUser.skillsOffered.length;
    const skillsWantedCount = currentUser.skillsWanted.length;
    
    const activeExchangesCount = exchanges.filter(
      e => (e.proposerId === currentUser.id || e.partnerId === currentUser.id) && e.status === 'Active'
    ).length;

    const completedExchangesCount = exchanges.filter(
      e => (e.proposerId === currentUser.id || e.partnerId === currentUser.id) && e.status === 'Completed'
    ).length;

    return {
      skillsOfferedCount,
      skillsWantedCount,
      activeExchangesCount,
      completedExchangesCount
    };
  }, [currentUser, exchanges]);

  // 2. Recommended Learning Partners (Top 3 highest match scores)
  const recommendedPartners = useMemo(() => {
    return students
      .filter(s => s.id !== currentUser.id)
      .map(candidate => calculateMatchScore(currentUser, candidate))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [students, currentUser]);

  // 3. Upcoming Sessions
  const upcomingSessions = useMemo(() => {
    return sessions
      .filter(s => s.status === 'Upcoming')
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
      .slice(0, 3);
  }, [sessions]);

  // 4. Pending Received Connection Requests
  const pendingReceivedRequests = useMemo(() => {
    return connections.filter(
      c => c.receiverId === currentUser.id && c.status === 'Pending'
    );
  }, [connections, currentUser]);

  // 5. Recent Activity Feed
  const recentActivities = useMemo(() => {
    const list: Array<{
      id: string;
      title: string;
      subtitle: string;
      time: string;
      icon: any;
      iconColor: string;
    }> = [];

    // Active / completed exchanges
    exchanges.forEach(e => {
      const partner = students.find(s => s.id === (e.proposerId === currentUser.id ? e.partnerId : e.proposerId));
      if (e.status === 'Active') {
        list.push({
          id: `act_exch_${e.id}`,
          title: `Active Exchange with ${partner?.name || 'Peer'}`,
          subtitle: `Trading "${e.teachSkillName}" for "${e.learnSkillName}"`,
          time: 'Active now',
          icon: Repeat,
          iconColor: 'text-indigo-600 bg-indigo-50'
        });
      } else if (e.status === 'Completed') {
        list.push({
          id: `act_comp_${e.id}`,
          title: `Completed Exchange with ${partner?.name || 'Peer'}`,
          subtitle: `Finished barter on ${e.teachSkillName}`,
          time: 'Completed',
          icon: CheckCircle2,
          iconColor: 'text-emerald-600 bg-emerald-50'
        });
      }
    });

    // Upcoming sessions
    sessions.slice(0, 2).forEach(s => {
      const partner = students.find(p => p.id === s.partnerId);
      list.push({
        id: `act_sess_${s.id}`,
        title: `Session Scheduled: ${s.skillName}`,
        subtitle: `With ${partner?.name || 'Peer'} on ${s.date} at ${s.startTime}`,
        time: s.status,
        icon: Calendar,
        iconColor: 'text-sky-600 bg-sky-50'
      });
    });

    // Unlocked achievements
    achievements.filter(a => a.isUnlocked).slice(0, 2).forEach(a => {
      list.push({
        id: `act_ach_${a.id}`,
        title: `Achievement Earned: ${a.title}`,
        subtitle: a.description,
        time: a.unlockedAt || 'Recent',
        icon: Award,
        iconColor: 'text-amber-600 bg-amber-50'
      });
    });

    return list.slice(0, 4);
  }, [exchanges, sessions, achievements, students, currentUser]);

  return (
    <div className="space-y-8">
      {/* 1. WELCOME BANNER */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-700 rounded-3xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="max-w-2xl space-y-2 relative z-10">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-200 bg-white/10 px-3 py-1 rounded-full backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Active Student Portal</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {getGreeting()}, {currentUser.name.split(' ')[0]}!
          </h2>
          <p className="text-xs sm:text-sm text-indigo-100 leading-relaxed">
            Ready to learn something new today? You have {recommendedPartners.length} high-compatibility peer matches waiting to exchange skills with you.
          </p>

          <div className="pt-3 flex flex-wrap gap-2.5">
            <Link
              to="/matches"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-900 bg-white hover:bg-indigo-50 rounded-xl transition-colors shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              View Mutual Matches
            </Link>
            <Link
              to="/my-skills"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-500/40 hover:bg-indigo-500/60 border border-white/20 rounded-xl transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Manage Skills Portfolio
            </Link>
            <Link
              to="/payments"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-amber-200 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 rounded-xl transition-colors"
            >
              <Wallet className="w-3.5 h-3.5 text-amber-300" />
              <span>Campus Wallet: ${walletBalance.toFixed(2)}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* 2. DYNAMIC STATISTICS CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Skills Offered */}
        <div 
          onClick={() => navigate('/my-skills')}
          className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-indigo-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">Skills Offered</span>
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <BookOpen className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {stats.skillsOfferedCount}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Available to teach peers</p>
        </div>

        {/* Skills Wanted */}
        <div 
          onClick={() => navigate('/my-skills')}
          className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-violet-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">Skills Wanted</span>
            <div className="p-2 rounded-xl bg-violet-50 text-violet-700 group-hover:bg-violet-700 group-hover:text-white transition-colors">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {stats.skillsWantedCount}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Active learning goals</p>
        </div>

        {/* Active Exchanges */}
        <div 
          onClick={() => navigate('/skill-exchanges')}
          className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-sky-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">Active Exchanges</span>
            <div className="p-2 rounded-xl bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white transition-colors">
              <Repeat className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {stats.activeExchangesCount}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">In-progress partnerships</p>
        </div>

        {/* Completed Exchanges */}
        <div 
          onClick={() => navigate('/skill-exchanges')}
          className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-emerald-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">Completed Swaps</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {stats.completedExchangesCount}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Validated peer reviews</p>
        </div>
      </div>

      {/* 3. PENDING REQUESTS ALERT IF PRESENT */}
      {pendingReceivedRequests.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200/80 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Pending Connection Requests ({pendingReceivedRequests.length})
              </h3>
            </div>
            <Link to="/connections" className="text-xs font-semibold text-indigo-600 hover:underline">
              View all requests
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingReceivedRequests.map((req) => {
              const sender = students.find(s => s.id === req.senderId);
              if (!sender) return null;
              return (
                <div key={req.id} className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={sender.name} initials={sender.initials} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{sender.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{sender.college}</p>
                      {req.message && (
                        <p className="text-[11px] text-slate-600 italic line-clamp-1 mt-0.5">"{req.message}"</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => respondConnectionRequest(req.id, 'Accepted')}
                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                      title="Accept Connection"
                      aria-label="Accept"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => respondConnectionRequest(req.id, 'Declined')}
                      className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                      title="Decline Connection"
                      aria-label="Decline"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. MAIN SPLIT: RECOMMENDED PARTNERS (Left) & SESSIONS / ACTIVITY (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (8 cols): Recommended Partners */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Recommended Learning Partners
              </h3>
              <p className="text-xs text-slate-500">
                Calculated based on your desired skills and reciprocal exchange opportunities.
              </p>
            </div>
            <Link
              to="/matches"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              See all matches <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-4">
            {recommendedPartners.map((result) => (
              <StudentCard
                key={result.student.id}
                student={result.student}
                matchResult={result}
              />
            ))}
          </div>
        </div>

        {/* Right Column (4 cols): Upcoming Sessions & Activity */}
        <div className="lg:col-span-4 space-y-6">
          {/* Upcoming Sessions */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Upcoming Sessions
                </h3>
              </div>
              <Link to="/sessions" className="text-xs font-semibold text-indigo-600 hover:underline">
                Manage
              </Link>
            </div>

            {upcomingSessions.length > 0 ? (
              <div className="space-y-3">
                {upcomingSessions.map((session) => {
                  const partner = students.find(s => s.id === session.partnerId);
                  return (
                    <div
                      key={session.id}
                      onClick={() => navigate('/sessions')}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-indigo-300 transition-colors cursor-pointer space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {session.skillName}
                        </span>
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                          {session.durationMinutes}m
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 flex items-center gap-1.5">
                        <Avatar name={partner?.name || 'Partner'} initials={partner?.initials} size="xs" />
                        <span className="truncate">With {partner?.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 pt-1 border-t border-slate-200/50">
                        <span className="font-medium text-slate-700">{session.date}</span>
                        <span>·</span>
                        <span>{session.startTime}</span>
                        <span>·</span>
                        <span>{session.learningMethod}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 space-y-2">
                <Clock className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-xs text-slate-500">No upcoming learning sessions.</p>
                <Link
                  to="/sessions"
                  className="inline-block text-xs font-semibold text-indigo-600 hover:underline"
                >
                  Schedule a session →
                </Link>
              </div>
            )}
          </div>

          {/* Recent Activity Timeline */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Recent Activity
            </h3>

            {recentActivities.length > 0 ? (
              <div className="space-y-3.5">
                {recentActivities.map((act) => {
                  const Icon = act.icon;
                  return (
                    <div key={act.id} className="flex items-start gap-3 text-xs">
                      <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${act.iconColor}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 leading-tight">
                          {act.title}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {act.subtitle}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {act.time}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-4 text-center">
                No recent activity logged yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
