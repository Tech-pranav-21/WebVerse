import React, { useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Avatar } from './Avatar';
import { 
  Menu, 
  Plus, 
  Repeat, 
  Sparkles, 
  ChevronDown, 
  UserCheck, 
  RefreshCw,
  Wallet,
  Crown
} from 'lucide-react';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  onOpenAddSkill: () => void;
  onOpenProposeExchange: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  onOpenAddSkill,
  onOpenProposeExchange
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, students, loginAs, resetDemoData, walletBalance, subscription, topUpWallet } = useApp();

  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Derive title from pathname
  const getPageInfo = () => {
    const path = location.pathname;
    if (path === '/dashboard') return { title: 'Dashboard', sub: 'Your peer learning overview' };
    if (path === '/explore') return { title: 'Explore Skills', sub: 'Discover peer talents across universities' };
    if (path === '/my-skills') return { title: 'My Skills', sub: 'Manage what you can teach and want to learn' };
    if (path === '/matches') return { title: 'Find Matches', sub: 'Algorithmic mutual skill pairing' };
    if (path === '/connections') return { title: 'Connections', sub: 'Peer network and requests' };
    if (path === '/skill-exchanges') return { title: 'Skill Exchanges', sub: 'Two-way learning partnerships' };
    if (path === '/messages') return { title: 'Messages', sub: 'Direct peer conversations' };
    if (path === '/sessions') return { title: 'Learning Sessions', sub: 'Schedule and manage peer meetups' };
    if (path === '/reviews') return { title: 'Reviews & Ratings', sub: 'Peer feedback and credibility' };
    if (path === '/achievements') return { title: 'Achievements', sub: 'Learning milestones and badges' };
    if (path === '/payments') return { title: 'Billing & Wallet', sub: 'Campus credit balance, Pro membership, and receipts' };
    if (path === '/settings') return { title: 'Settings', sub: 'Preferences and demo account management' };
    if (path.startsWith('/students/')) return { title: 'Student Profile', sub: 'Detailed academic background and skills' };
    return { title: 'SkillBridge', sub: 'Student Skill Exchange' };
  };

  const { title, sub } = getPageInfo();

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Left: Mobile hamburger & Title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className="md:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          aria-label="Open sidebar menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-base font-bold text-slate-900 leading-tight">
            {title}
          </h1>
          <p className="text-[11px] text-slate-500 hidden sm:block">
            {sub}
          </p>
        </div>
      </div>

      {/* Right: Quick Actions & Switch Demo User */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Wallet Credit Balance Pill */}
        <button
          type="button"
          onClick={() => navigate('/payments')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50/80 hover:bg-amber-100/80 border border-amber-200/90 text-amber-900 transition-colors shadow-2xs group"
          title="Campus Wallet Balance - Click to manage or add funds"
        >
          <Wallet className="w-3.5 h-3.5 text-amber-600 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-black tracking-tight tabular-nums">
            ${walletBalance.toFixed(2)}
          </span>
          <span 
            onClick={(e) => {
              e.stopPropagation();
              topUpWallet(25);
            }}
            className="w-4 h-4 rounded-full bg-amber-200/90 hover:bg-amber-300 text-amber-900 flex items-center justify-center text-[11px] font-bold shrink-0 ml-0.5"
            title="Quick Top Up $25"
          >
            +
          </span>
        </button>

        {/* Quick action buttons */}
        <button
          type="button"
          onClick={onOpenAddSkill}
          className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-slate-600" />
          Add Skill
        </button>

        <button
          type="button"
          onClick={onOpenProposeExchange}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
        >
          <Repeat className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Propose Exchange</span>
          <span className="sm:hidden">Propose</span>
        </button>

        {/* Demo Account Switcher Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen(!switcherOpen)}
            className="flex items-center gap-2 p-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-left"
            title="Switch demo student view"
          >
            {currentUser && (
              <Avatar name={currentUser.name} initials={currentUser.initials} size="sm" />
            )}
            <div className="hidden xl:block pr-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-slate-800 block leading-tight">
                  {currentUser?.name || 'Guest'}
                </span>
                {subscription.plan !== 'free' && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                    <Crown className="w-2.5 h-2.5 fill-amber-500" />
                    PRO
                  </span>
                )}
              </div>
              <span className="text-[10px] text-indigo-600 font-medium leading-none">
                Demo Student
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* Switcher popover */}
          {switcherOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSwitcherOpen(false)} />
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 z-40 p-2 overflow-hidden animate-in fade-in duration-150">
                <div className="px-3 py-2 border-b border-slate-100 mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Switch Active Demo Student
                  </span>
                  <button
                    onClick={() => {
                      resetDemoData();
                      setSwitcherOpen(false);
                    }}
                    title="Reset all demo data to factory state"
                    className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1">
                  {students.slice(0, 6).map((student) => {
                    const isSelected = student.id === currentUser?.id;
                    return (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => {
                          loginAs(student.id);
                          setSwitcherOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-colors ${
                          isSelected ? 'bg-indigo-50 border border-indigo-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={student.name} initials={student.initials} size="xs" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {student.name}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {student.department} · {student.college}
                            </p>
                          </div>
                        </div>
                        {isSelected && (
                          <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="p-2 border-t border-slate-100 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      navigate('/settings');
                      setSwitcherOpen(false);
                    }}
                    className="w-full text-center py-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600"
                  >
                    View Account & Privacy Settings →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
