import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { GraduationCap, Eye, EyeOff, Lock, Mail, ArrowRight, UserCheck } from 'lucide-react';
import { INITIAL_CURRENT_USER } from '../../data/initialData';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginAs, students } = useApp();

  const [email, setEmail] = useState('pranav.patel@stanford.edu');
  const [password, setPassword] = useState('demo-password123');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  const validateEmail = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your university email address.');
      return;
    }
    if (!validateEmail(email.trim())) {
      setError('Please enter a valid email address (e.g. name@university.edu).');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      login(email);
      setLoading(false);
      navigate(from, { replace: true });
    }, 400);
  };

  const handleQuickLogin = (studentId: string) => {
    loginAs(studentId);
    navigate(from, { replace: true });
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-lg p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-xs">
            <GraduationCap className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            Welcome back to SkillBridge
          </h2>
          <p className="text-xs text-slate-500">
            Log in to continue exchanging skills with university peers.
          </p>
        </div>

        {/* Quick Demo Access Bar */}
        <div className="p-3.5 rounded-xl bg-indigo-50/80 border border-indigo-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
              Quick Demo Access
            </span>
            <span className="text-[10px] text-indigo-600 font-medium">1-Click Test</span>
          </div>
          <button
            type="button"
            onClick={() => handleQuickLogin(INITIAL_CURRENT_USER.id)}
            className="w-full py-2 px-3 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
          >
            <span>Log in as Pranav Patel (Demo Student)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          {/* Quick peer switcher */}
          <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-slate-500">
            <span>Or switch to:</span>
            <button
              type="button"
              onClick={() => handleQuickLogin('student_aisha')}
              className="text-indigo-600 hover:underline font-semibold"
            >
              Aisha (React)
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleQuickLogin('student_marcus')}
              className="text-indigo-600 hover:underline font-semibold"
            >
              Marcus (Figma)
            </button>
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
              University Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                placeholder="name@university.edu"
                className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
              <span className="text-[11px] text-slate-400">Demo only</span>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder="••••••••"
                className="w-full pl-10 pr-10 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="p-1 text-slate-400 hover:text-slate-600 absolute right-3 top-1/2 -translate-y-1/2"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-70"
          >
            {loading ? 'Authenticating...' : 'Sign In to SkillBridge'}
          </button>
        </form>

        {/* Footer link to register */}
        <div className="pt-4 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-600">
            Don't have a profile yet?{' '}
            <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-800">
              Create an account
            </Link>
          </p>
          <p className="text-[11px] text-slate-400 mt-2">
            Simulated frontend demo. No external passwords stored.
          </p>
        </div>
      </div>
    </div>
  );
};
