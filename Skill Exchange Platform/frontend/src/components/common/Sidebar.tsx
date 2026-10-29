import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Avatar } from './Avatar';
import { 
  GraduationCap, 
  LayoutDashboard, 
  Compass, 
  BookOpen, 
  Sparkles, 
  Users, 
  Repeat, 
  MessageSquare, 
  Calendar, 
  Award, 
  Settings, 
  LogOut,
  ChevronRight,
  X,
  Star,
  CreditCard
} from 'lucide-react';

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onCloseMobile }) => {
  const { currentUser, conversations, logout, subscription } = useApp();
  const navigate = useNavigate();

  // Calculate total unread messages
  const totalUnreadMessages = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Explore Skills', path: '/explore', icon: Compass },
    { name: 'My Skills', path: '/my-skills', icon: BookOpen },
    { name: 'Find Matches', path: '/matches', icon: Sparkles, badge: 'Smart' },
    { name: 'Connections', path: '/connections', icon: Users },
    { name: 'Skill Exchanges', path: '/skill-exchanges', icon: Repeat },
    { 
      name: 'Messages', 
      path: '/messages', 
      icon: MessageSquare,
      badgeCount: totalUnreadMessages > 0 ? totalUnreadMessages : undefined 
    },
    { name: 'Learning Sessions', path: '/sessions', icon: Calendar },
    { name: 'Reviews & Ratings', path: '/reviews', icon: Star },
    { name: 'Achievements', path: '/achievements', icon: Award },
    { 
      name: 'Billing & Wallet', 
      path: '/payments', 
      icon: CreditCard,
      badge: subscription.plan !== 'free' ? 'PRO' : 'Demo'
    },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const content = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-64 select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100">
        <NavLink to="/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <span className="text-base font-bold text-slate-900 tracking-tight leading-none block">
              SkillBridge
            </span>
            <span className="text-[10px] text-indigo-600 font-medium tracking-wide">
              Peer Learning
            </span>
          </div>
        </NavLink>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Platform Menu
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onCloseMobile}
              className={({ isActive }) => `
                flex items-center justify-between px-3 py-2 text-xs font-medium rounded-xl transition-all duration-150 group
                ${isActive 
                  ? 'bg-indigo-50 text-indigo-700 font-semibold' 
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }
              `}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 shrink-0 transition-colors" />
                <span className="truncate">{item.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {item.badge && (
                  <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded font-medium">
                    {item.badge}
                  </span>
                )}
                {item.badgeCount && (
                  <span className="text-[10px] bg-rose-500 text-white font-bold px-1.5 py-0.2 rounded-full tabular-nums">
                    {item.badgeCount}
                  </span>
                )}
              </div>
            </NavLink>
          );
        })}
      </nav>

      {/* User Footer Profile */}
      {currentUser && (
        <div className="p-3 border-t border-slate-100">
          <div 
            onClick={() => {
              navigate(`/students/${currentUser.id}`);
              if (onCloseMobile) onCloseMobile();
            }}
            className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={currentUser.name} initials={currentUser.initials} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                  {currentUser.name}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {currentUser.college}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLogout();
              }}
              title="Sign Out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="hidden md:flex flex-col h-screen sticky top-0 shrink-0 z-30">
        {content}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
