import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { GraduationCap, Menu, X, ArrowRight, LayoutDashboard } from 'lucide-react';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const { currentUser } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark */}
        <Link to="/" className="flex items-center gap-2.5 whitespace-nowrap shrink-0 group">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs group-hover:bg-indigo-700 transition-colors">
            <GraduationCap className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">
            SkillBridge
          </span>
        </Link>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <Link
            to="/"
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isActive('/') ? 'text-indigo-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            Home
          </Link>
          <Link
            to="/explore"
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isActive('/explore') ? 'text-indigo-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            Explore Skills
          </Link>
          <Link
            to="/how-it-works"
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isActive('/how-it-works') ? 'text-indigo-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            How It Works
          </Link>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          {currentUser ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs whitespace-nowrap shrink-0"
            >
              <LayoutDashboard className="w-4 h-4" />
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                Log In
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs whitespace-nowrap shrink-0"
              >
                Join the Community
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <div className="flex md:hidden items-center">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-slate-200 bg-white px-4 pt-3 pb-5 space-y-3">
          <div className="flex flex-col space-y-2">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                isActive('/') ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              Home
            </Link>
            <Link
              to="/explore"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                isActive('/explore') ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              Explore Skills
            </Link>
            <Link
              to="/how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                isActive('/how-it-works') ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              How It Works
            </Link>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            {currentUser ? (
              <Link
                to="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Log In
                </Link>
                <Link
                  to="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors"
                >
                  Join the Community
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
