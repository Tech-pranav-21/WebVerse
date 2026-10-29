import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { StudentCard } from '../../components/common/StudentCard';
import { 
  Code2, 
  Globe, 
  Database, 
  Cpu, 
  Palette, 
  BarChart3, 
  MessageCircle, 
  Briefcase,
  ArrowRight,
  Sparkles,
  Users,
  Repeat,
  CheckCircle2,
  BookOpen,
  CalendarCheck,
  CreditCard,
  Wallet,
  Crown,
  ShieldCheck
} from 'lucide-react';
import heroImage from '../../assets/images/hero_students_collaborating_1792643281489.jpg';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { students, currentUser } = useApp();

  // Popular Categories with dynamic counts
  const categories = [
    {
      id: 'Programming',
      name: 'Programming',
      icon: Code2,
      desc: 'Java, Python, C++, Swift, and OOP concepts'
    },
    {
      id: 'Web Development',
      name: 'Web Development',
      icon: Globe,
      desc: 'React, Next.js, Tailwind CSS, and full-stack JS'
    },
    {
      id: 'Data Science',
      name: 'Data Science',
      icon: BarChart3,
      desc: 'Machine learning, Pandas, Tableau, and data modeling'
    },
    {
      id: 'Database Management',
      name: 'Database Management',
      icon: Database,
      desc: 'PostgreSQL, query planning, indexing, and schemas'
    },
    {
      id: 'UI/UX Design',
      name: 'UI/UX Design',
      icon: Palette,
      desc: 'Figma prototypes, design systems, and user research'
    },
    {
      id: 'Computer Science',
      name: 'Computer Science',
      icon: Cpu,
      desc: 'Data structures, algorithms, Linux, and Docker'
    },
    {
      id: 'Communication',
      name: 'Communication',
      icon: MessageCircle,
      desc: 'Public speaking, pitch presentations, and rhetoric'
    },
    {
      id: 'Career Development',
      name: 'Career Development',
      icon: Briefcase,
      desc: 'Technical resume crafting and behavioral interview prep'
    }
  ];

  // Calculate live count of offered skills per category from students
  const getCategoryCount = (categoryName: string) => {
    return students.reduce((acc, student) => {
      return acc + student.skillsOffered.filter(s => s.category === categoryName).length;
    }, 0);
  };

  // Featured students (excluding current user, taking top 3)
  const featuredStudents = students
    .filter(s => s.id !== currentUser?.id)
    .slice(0, 3);

  return (
    <div className="space-y-24 py-8">
      {/* 1. HERO SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Text */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-3 py-1.5 rounded-full">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Collegiate Peer-to-Peer Learning Network</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.1] text-balance">
              Your Skills Can Take You Further.
            </h1>

            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
              Connect with fellow students, exchange knowledge, and master new skills together. Teach what you know. Learn what you love.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/explore"
                className="px-6 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-md shadow-indigo-600/20 whitespace-nowrap shrink-0"
              >
                Explore Skills
              </Link>
              <Link
                to={currentUser ? "/dashboard" : "/register"}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all shadow-xs whitespace-nowrap shrink-0"
              >
                {currentUser ? "Open Dashboard" : "Join the Community"}
                <ArrowRight className="w-4 h-4 text-indigo-600" />
              </Link>
            </div>

            {/* Trust Indicators (Illustrative Demo Figures) */}
            <div className="pt-6 border-t border-slate-200/80 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                  100% Free
                </p>
                <p className="text-xs text-slate-500 font-medium">No paid courses</p>
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                  1-on-1 Swaps
                </p>
                <p className="text-xs text-slate-500 font-medium">Mutual mentorship</p>
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                  Top Colleges
                </p>
                <p className="text-xs text-slate-500 font-medium">Cross-campus cohort</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 italic">
              * Figures demonstrate interactive prototype data for academic presentation.
            </p>
          </div>

          {/* Right Visual Image */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-xl bg-slate-100 aspect-16/10 lg:aspect-4/3 group">
              <img
                src={heroImage}
                alt="University students collaborating and exchanging skills at an open study table"
                className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-4 left-4 right-4 text-white p-3 rounded-xl bg-slate-900/70 backdrop-blur-xs border border-white/10">
                <p className="text-xs font-semibold leading-tight">Peer Learning Partnership</p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  "I taught Spring Boot; my partner taught me Figma. We both leveled up."
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. POPULAR SKILL CATEGORIES */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Popular Skill Categories
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Explore skills offered by active university students across engineering, design, and business.
            </p>
          </div>
          <Link
            to="/explore"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 shrink-0"
          >
            Browse all categories <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const count = getCategoryCount(cat.name);
            return (
              <div
                key={cat.id}
                onClick={() => navigate(`/explore?category=${encodeURIComponent(cat.name)}`)}
                className="bg-white rounded-2xl border border-slate-200/90 p-5 hover:border-indigo-400 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                    {cat.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {cat.desc}
                  </p>
                </div>

                <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 tabular-nums">
                    {count} {count === 1 ? 'skill listed' : 'skills listed'}
                  </span>
                  <span className="text-indigo-600 font-semibold group-hover:translate-x-0.5 transition-transform">
                    Explore →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. HOW IT WORKS */}
      <section className="bg-white border-y border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              How SkillBridge Works
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2">
              Three simple steps to exchange knowledge and gain hands-on peer experience without paying for tuition courses.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Step 1 */}
            <div className="relative bg-[#F8FAFC] rounded-2xl p-6 border border-slate-200/80">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center text-sm mb-4 shadow-xs">
                01
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">
                Create Your Profile
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Add skills you can comfortably teach (like Java, Python, or SQL) and skills you are eager to learn (like React, Figma, or Docker).
              </p>
            </div>

            {/* Step 2 */}
            <div className="relative bg-[#F8FAFC] rounded-2xl p-6 border border-slate-200/80">
              <div className="w-10 h-10 rounded-xl bg-violet-600 text-white font-bold flex items-center justify-center text-sm mb-4 shadow-xs">
                02
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">
                Find Your Learning Partner
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Our transparent matching algorithm finds students with reciprocal needs—someone who offers what you want, and wants what you teach.
              </p>
            </div>

            {/* Step 3 */}
            <div className="relative bg-[#F8FAFC] rounded-2xl p-6 border border-slate-200/80">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center text-sm mb-4 shadow-xs">
                03
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">
                Exchange Skills and Grow
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Propose an exchange, schedule 1-on-1 sessions, practice real exercises together, and review each other to build your portfolio.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. FEATURED STUDENTS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Featured Student Profiles
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Connect with motivated undergraduate and graduate peers looking to partner right now.
            </p>
          </div>
          <Link
            to="/explore"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 shrink-0"
          >
            View all {students.length} students <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredStudents.map((student) => (
            <StudentCard key={student.id} student={student} />
          ))}
        </div>
      </section>

      {/* 5. BENEFITS SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-indigo-900 text-white rounded-3xl p-8 sm:p-12 relative overflow-hidden">
          <div className="max-w-2xl space-y-4 relative z-10">
            <span className="text-xs uppercase font-bold tracking-wider text-indigo-300">
              Why Peer Skill Exchange Works
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
              Learn faster by teaching, and build a lasting network.
            </h2>
            <p className="text-xs sm:text-sm text-indigo-200 leading-relaxed">
              Research shows teaching peers solidifies your own retention by up to 90%. SkillBridge turns every campus into an open mutual workshop.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-white">Learn without expensive courses</h4>
                  <p className="text-xs text-indigo-200 mt-0.5">High-touch 1-on-1 tutoring without financial cost.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-white">Teach skills you already know</h4>
                  <p className="text-xs text-indigo-200 mt-0.5">Cement your foundation by explaining fundamentals.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-white">Meet like-minded peers</h4>
                  <p className="text-xs text-indigo-200 mt-0.5">Collaborate with students in similar technical domains.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-white">Build practical portfolio proof</h4>
                  <p className="text-xs text-indigo-200 mt-0.5">Earn verified peer testimonials and exchange badges.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. SKILLBRIDGE PRO & PEER CREDITS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-8 sm:p-12 text-white shadow-xl border border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold">
              <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span>SkillBridge Pro & Campus Wallet</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Flexible Peer Barter + Fast-Track Pro Mentorship
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              SkillBridge is 100% free for two-way peer learning. Want priority matching or to show gratitude to top tutors? Our built-in Demo Payment Sandbox lets you tip mentors, book 1-on-1 consultations, and test full card & UPI checkouts with zero real charges.
            </p>

            <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-indigo-400" />
                <span>Card, UPI & Net Banking</span>
              </div>
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-amber-400" />
                <span>Zero-Fee Student Wallet</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Sandbox 256-Bit SSL Demo</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col items-center sm:items-end justify-center">
            <div className="bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 border border-slate-700/80 w-full max-w-sm space-y-4 text-center sm:text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300">SkillBridge Pro</span>
                <span className="text-xs font-extrabold text-amber-400">$9.99 / mo</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Includes 3x matching boost, verified tutor credential, and AI session summaries.
              </p>
              <Link
                to={currentUser ? "/payments" : "/login"}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 transition-colors shadow-xs"
              >
                <span>Explore Demo Billing & Wallet</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 7. FINAL CTA */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-5">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Your Next Learning Partner Is Waiting.
        </h2>
        <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
          Sign up with your college email, list what you want to learn, and let our mutual matching system pair you with the ideal peer.
        </p>
        <div className="pt-2">
          <Link
            to={currentUser ? "/matches" : "/register"}
            className="inline-flex items-center gap-2 px-8 py-3.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-md shadow-indigo-600/25"
          >
            Start Exchanging Skills
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
};
