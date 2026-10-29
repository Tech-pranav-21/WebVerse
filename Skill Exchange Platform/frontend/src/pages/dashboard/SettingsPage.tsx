import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { YearOfStudy, LearningMethod } from '../../types';
import { 
  User, 
  Sliders, 
  Shield, 
  Trash2, 
  RotateCcw, 
  LogOut, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    preferences, 
    updateProfile, 
    updatePreferences, 
    resetDemoData, 
    deleteDemoAccount,
    logout 
  } = useApp();

  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'privacy' | 'account'>('profile');

  // Profile form state
  const [name, setName] = useState(currentUser?.name || '');
  const [college, setCollege] = useState(currentUser?.college || '');
  const [department, setDepartment] = useState(currentUser?.department || '');
  const [yearOfStudy, setYearOfStudy] = useState<YearOfStudy>(currentUser?.yearOfStudy || 'Third Year');
  const [bio, setBio] = useState(currentUser?.bio || '');

  // Preferences form state
  const [learningMethod, setLearningMethod] = useState<LearningMethod>(preferences.learningMethod);
  const [preferredDays, setPreferredDays] = useState<string[]>(preferences.preferredDays);
  const [preferredTimes, setPreferredTimes] = useState(preferences.preferredTimes.join(', '));
  const [interests, setInterests] = useState(preferences.interests.join(', '));

  // Privacy form state
  const [profileVisibility, setProfileVisibility] = useState(preferences.profileVisibility);
  const [showCollege, setShowCollege] = useState(preferences.showCollege);
  const [showEmail, setShowEmail] = useState(preferences.showEmail);

  // Dialog states
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (!currentUser) return null;

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({
      name: name.trim(),
      college: college.trim(),
      department: department.trim(),
      yearOfStudy,
      bio: bio.trim()
    });
  };

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    updatePreferences({
      ...preferences,
      learningMethod,
      preferredDays,
      preferredTimes: preferredTimes.split(',').map(s => s.trim()).filter(Boolean),
      interests: interests.split(',').map(s => s.trim()).filter(Boolean)
    });
  };

  const handleSavePrivacy = (e: React.FormEvent) => {
    e.preventDefault();
    updatePreferences({
      ...preferences,
      profileVisibility,
      showCollege,
      showEmail
    });
  };

  const toggleDay = (day: string) => {
    setPreferredDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Settings & Account Management
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Customize your academic profile, availability preferences, and local prototype state.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit text-xs font-medium overflow-x-auto">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'profile' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Profile Details</span>
        </button>
        <button
          onClick={() => setActiveTab('preferences')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'preferences' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Learning Preferences</span>
        </button>
        <button
          onClick={() => setActiveTab('privacy')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'privacy' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Privacy</span>
        </button>
        <button
          onClick={() => setActiveTab('account')}
          className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'account' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Demo Controls</span>
        </button>
      </div>

      {/* SECTION 1: Profile Details */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs max-w-2xl">
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label htmlFor="settings-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Full Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="settings-college" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  University / College
                </label>
                <input
                  id="settings-college"
                  type="text"
                  value={college}
                  onChange={(e) => setCollege(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
                />
              </div>

              <div>
                <label htmlFor="settings-department" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Major / Department
                </label>
                <input
                  id="settings-department"
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
                />
              </div>
            </div>

            <div>
              <label htmlFor="settings-year" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Year of Study
              </label>
              <select
                id="settings-year"
                value={yearOfStudy}
                onChange={(e) => setYearOfStudy(e.target.value as YearOfStudy)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
              >
                <option value="First Year">First Year</option>
                <option value="Second Year">Second Year</option>
                <option value="Third Year">Third Year</option>
                <option value="Fourth Year">Fourth Year</option>
                <option value="Graduate / Other">Graduate / Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="settings-bio" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Profile Bio & Learning Goals
              </label>
              <textarea
                id="settings-bio"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white resize-none"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
              >
                Save Profile Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SECTION 2: Learning Preferences */}
      {activeTab === 'preferences' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs max-w-2xl">
          <form onSubmit={handleSavePreferences} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Preferred Learning Format
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Online', 'In-person', 'Flexible'] as const).map(method => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setLearningMethod(method)}
                    className={`py-2 text-xs font-semibold rounded-xl border transition-colors ${
                      learningMethod === method
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Available Study Days
              </label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map(day => {
                  const selected = preferredDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="settings-times" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Preferred Time Windows
              </label>
              <input
                id="settings-times"
                type="text"
                value={preferredTimes}
                onChange={(e) => setPreferredTimes(e.target.value)}
                placeholder="e.g. 18:00 - 21:00, Weekends Morning"
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
              />
            </div>

            <div>
              <label htmlFor="settings-interests" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Learning Interest Tags (comma separated)
              </label>
              <input
                id="settings-interests"
                type="text"
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
                placeholder="e.g. Distributed Systems, UI/UX, Cloud, Algorithms"
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
              >
                Save Learning Preferences
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SECTION 3: Privacy Settings */}
      {activeTab === 'privacy' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs max-w-2xl space-y-6">
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs leading-relaxed space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Prototype Notice</span>
            </div>
            <p className="text-amber-800">
              Frontend privacy preferences are demonstrative and illustrate how user data sharing would be controlled before future backend deployment.
            </p>
          </div>

          <form onSubmit={handleSavePrivacy} className="space-y-4">
            <div>
              <label htmlFor="settings-visibility" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Profile Visibility
              </label>
              <select
                id="settings-visibility"
                value={profileVisibility}
                onChange={(e) => setProfileVisibility(e.target.value as any)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 bg-white"
              >
                <option value="Public">Public (All verified university students)</option>
                <option value="Campus">Campus Only (Students from my university)</option>
                <option value="Connections">Connections Only (Accepted peers only)</option>
              </select>
            </div>

            <div className="space-y-3 pt-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCollege}
                  onChange={(e) => setShowCollege(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-700 font-medium">
                  Display my university name publicly on skill cards
                </span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEmail}
                  onChange={(e) => setShowEmail(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-700 font-medium">
                  Display university email address to connected peers
                </span>
              </label>
            </div>

            <div className="pt-3">
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
              >
                Save Privacy Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SECTION 4: Demo Controls & Account */}
      {activeTab === 'account' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs max-w-2xl space-y-6">
          <div>
            <h2 className="text-sm font-bold text-slate-900 mb-1">
              Demo Environment Controls
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Use these utilities to reset sample data or simulate fresh student registration.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Sign Out of Session</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Logs out of the current demo student profile and returns to login.
              </p>
            </div>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors shadow-2xs shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-600" />
              Sign Out
            </button>
          </div>

          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-indigo-900">Reset Demo Data to Factory State</h3>
              <p className="text-[11px] text-indigo-700 mt-0.5">
                Restores the initial 10 students, default exchanges, messages, and reviews in LocalStorage.
              </p>
            </div>
            <button
              onClick={() => setConfirmResetOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Factory Data
            </button>
          </div>

          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-rose-900">Delete Current Demo Profile</h3>
              <p className="text-[11px] text-rose-700 mt-0.5">
                Removes this student profile from the active local browser storage.
              </p>
            </div>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-xs shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Profile
            </button>
          </div>
        </div>
      )}

      {/* Confirm Reset Dialog */}
      <ConfirmDialog
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={resetDemoData}
        title="Restore Factory Demo Data"
        message="This will reset all LocalStorage data to the default seeded student profiles, sessions, and messages."
        confirmLabel="Reset Everything"
        variant="warning"
      />

      {/* Confirm Delete Account Dialog */}
      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          deleteDemoAccount();
          navigate('/register');
        }}
        title="Delete Demo Account"
        message="Are you sure you want to delete this demo profile from LocalStorage? You can recreate it anytime."
        confirmLabel="Delete Account"
        variant="danger"
      />
    </div>
  );
};
