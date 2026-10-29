import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Shield, HelpCircle, Mail, FileText, Heart } from 'lucide-react';
import { Modal } from './Modal';

export const Footer: React.FC = () => {
  const [infoModal, setInfoModal] = useState<{ title: string; content: string } | null>(null);

  const openInfo = (title: string, content: string) => {
    setInfoModal({ title, content });
  };

  return (
    <footer className="bg-white border-t border-slate-200 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1: Brand & Bio */}
          <div className="space-y-3 md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                <GraduationCap className="w-4 h-4" />
              </div>
              <span className="text-base font-bold text-slate-900">SkillBridge</span>
            </Link>
            <p className="text-xs text-slate-500 leading-relaxed">
              Peer-to-peer student skill exchange and collaborative learning platform. Teach what you know. Learn what you love.
            </p>
            <div className="text-[11px] text-slate-400">
              College Engineering Project Showcase
            </div>
          </div>

          {/* Col 2: Navigation */}
          <div>
            <h4 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-3">
              Explore
            </h4>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>
                <Link to="/" className="hover:text-indigo-600 transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/explore" className="hover:text-indigo-600 transition-colors">
                  Explore Skills
                </Link>
              </li>
              <li>
                <Link to="/how-it-works" className="hover:text-indigo-600 transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-indigo-600 transition-colors">
                  Join Community
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Student Community */}
          <div>
            <h4 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-3">
              Community
            </h4>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>
                <button
                  type="button"
                  onClick={() => openInfo(
                    'About SkillBridge',
                    'SkillBridge was created as a collegiate open-learning initiative designed to bridge knowledge gaps across disciplines. Rather than purchasing costly courses, university students match with peers to exchange mutual expertise—like swapping Java backend coaching for Figma UI/UX design mentorship.'
                  )}
                  className="hover:text-indigo-600 transition-colors text-left"
                >
                  About the Platform
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openInfo(
                    'Peer Code of Conduct',
                    'All SkillBridge learners pledge to maintain a respectful, patient, and collaborative learning environment. Peer mentorship sessions are alcohol- and harassment-free academic spaces where students support each other\'s learning goals.'
                  )}
                  className="hover:text-indigo-600 transition-colors text-left"
                >
                  Code of Conduct
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openInfo(
                    'Contact & Support',
                    'For inquiries regarding SkillBridge campus chapters or technical feedback on this demo application, reach out to the engineering project maintainer at techpranav21@gmail.com.'
                  )}
                  className="hover:text-indigo-600 transition-colors text-left"
                >
                  Contact & Campus Support
                </button>
              </li>
            </ul>
          </div>

          {/* Col 4: Legal & Privacy */}
          <div>
            <h4 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-3">
              Policies
            </h4>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>
                <button
                  type="button"
                  onClick={() => openInfo(
                    'Privacy Policy (Demo Notice)',
                    'This is a local demonstration application. All profile data, session bookings, and simulated messages are persisted exclusively inside your browser\'s LocalStorage. No real telemetry, external advertising trackers, or sensitive credentials are ever collected or transmitted.'
                  )}
                  className="hover:text-indigo-600 transition-colors text-left"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openInfo(
                    'Terms of Service',
                    'SkillBridge is provided as an open academic demonstration tool. Users are encouraged to test match algorithms, session scheduling, and review systems respectfully.'
                  )}
                  className="hover:text-indigo-600 transition-colors text-left"
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openInfo(
                    'Academic Integrity Pledge',
                    'SkillBridge is designed for conceptual skill learning and collaborative tutoring. The platform strictly prohibits peer contract cheating, homework solving on behalf of others, or exam dishonesty.'
                  )}
                  className="hover:text-indigo-600 transition-colors text-left"
                >
                  Academic Integrity
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright row */}
        <div className="pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} SkillBridge. Built for student collaborative learning.</p>
          <div className="flex items-center gap-1 text-slate-400">
            <span>Powered by peer curiosity and collaboration</span>
          </div>
        </div>
      </div>

      {/* Info Modal */}
      {infoModal && (
        <Modal
          isOpen={true}
          onClose={() => setInfoModal(null)}
          title={infoModal.title}
          maxWidth="md"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
              {infoModal.content}
            </p>
            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </footer>
  );
};
