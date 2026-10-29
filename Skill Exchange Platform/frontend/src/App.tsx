import React from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { PublicLayout } from './layouts/PublicLayout';
import { AppLayout } from './layouts/AppLayout';

// Public Pages
import { LandingPage } from './pages/public/LandingPage';
import { LoginPage } from './pages/public/LoginPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { HowItWorksPage } from './pages/public/HowItWorksPage';
import { ExploreSkillsPage } from './pages/public/ExploreSkillsPage';

// Authenticated Pages
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { MySkillsPage } from './pages/dashboard/MySkillsPage';
import { FindMatchesPage } from './pages/dashboard/FindMatchesPage';
import { ConnectionsPage } from './pages/dashboard/ConnectionsPage';
import { SkillExchangesPage } from './pages/dashboard/SkillExchangesPage';
import { MessagesPage } from './pages/dashboard/MessagesPage';
import { LearningSessionsPage } from './pages/dashboard/LearningSessionsPage';
import { ReviewsPage } from './pages/dashboard/ReviewsPage';
import { AchievementsPage } from './pages/dashboard/AchievementsPage';
import { SettingsPage } from './pages/dashboard/SettingsPage';
import { StudentProfilePage } from './pages/dashboard/StudentProfilePage';
import { PaymentsPage } from './pages/dashboard/PaymentsPage';

/**
 * Adaptive Explorer route:
 * If authenticated, displays in AppLayout (with sidebar & header).
 * If guest, displays in PublicLayout (with public navbar & footer).
 */
const AdaptiveExplore: React.FC = () => {
  const { currentUser } = useApp();
  if (currentUser) {
    return <ExploreSkillsPage />;
  }
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <ExploreSkillsPage />
    </div>
  );
};

/**
 * Adaptive Student Profile route:
 * Allows public browsing of profiles or authenticated rich actions.
 */
const AdaptiveProfile: React.FC = () => {
  const { currentUser } = useApp();
  if (currentUser) {
    return <StudentProfilePage />;
  }
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <StudentProfilePage />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          {/* Public Pages */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* If guest accesses /explore or /students/:id, PublicLayout will wrap it */}
            <Route path="/guest-explore" element={<AdaptiveExplore />} />
          </Route>

          {/* Authenticated Workspace */}
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/explore" element={<ExploreSkillsPage />} />
            <Route path="/my-skills" element={<MySkillsPage />} />
            <Route path="/matches" element={<FindMatchesPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/skill-exchanges" element={<SkillExchangesPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/sessions" element={<LearningSessionsPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/students/:id" element={<StudentProfilePage />} />
          </Route>

          {/* Fallback to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
