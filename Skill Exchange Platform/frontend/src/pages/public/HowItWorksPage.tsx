import React from 'react';
import { Link } from 'react-router-dom';
import { 
  CheckCircle2, 
  HelpCircle, 
  Sparkles, 
  Repeat, 
  Calendar, 
  Award, 
  ShieldCheck,
  ArrowRight
} from 'lucide-react';

export const HowItWorksPage: React.FC = () => {
  const faqs = [
    {
      q: 'Do I need money or tokens to learn on SkillBridge?',
      a: 'No. SkillBridge operates on a pure barter exchange model: you teach what you know, and learn what you want. There are no course fees or paywalls.'
    },
    {
      q: 'How does the mutual matching score work?',
      a: 'Our algorithm checks if a peer offers a skill you want to learn (up to 50%), and whether you can teach a skill they want in return (up to 30%). Additional points are awarded for schedule and format compatibility.'
    },
    {
      q: 'What if I am only a beginner in most skills?',
      a: 'You do not need to be an industry expert! Undergraduates regularly teach fundamentals (e.g. Git basics, Python syntax, high-school calculus, or intro design) to peers starting out.'
    },
    {
      q: 'Where do learning sessions take place?',
      a: 'Peers can connect online via video calls or meet in-person at campus libraries or study lounges depending on their mutual preference.'
    }
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
      {/* Header */}
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
          Peer-to-Peer Learning Guide
        </span>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          How SkillBridge Works
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          The collaborative knowledge-sharing cycle designed for college students to master skills through active teaching and reciprocal practice.
        </p>
      </div>

      {/* 4 Steps In Detail */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
            01
          </div>
          <h3 className="text-base font-bold text-slate-900">
            1. Define Your Skills Portfolio
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            List topics you have mastered through coursework or personal projects in "Skills I Can Teach". Next, add technologies or subjects you want to explore in "Skills I Want to Learn".
          </p>
          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
            💡 <em>Tip: Add proficiency levels (Beginner, Intermediate, Advanced) to help peers gauge alignment.</em>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-violet-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
            02
          </div>
          <h3 className="text-base font-bold text-slate-900">
            2. Match With Reciprocal Peers
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            The platform surfaces students with complementary needs. If you teach Java and want React, you will be paired with students who teach React and want to learn Java.
          </p>
          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
            🎯 <em>Transparency: Compatibility percentages break down exact mutual overlaps.</em>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-sky-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
            03
          </div>
          <h3 className="text-base font-bold text-slate-900">
            3. Propose & Schedule Sessions
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Send an exchange proposal specifying what each peer will teach. Once accepted, use the session planner to schedule 45-60 minute interactive learning workshops.
          </p>
          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
            ⏱ <em>Recommended: 30 minutes of teaching from Partner A, followed by 30 minutes from Partner B.</em>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
            04
          </div>
          <h3 className="text-base font-bold text-slate-900">
            4. Review & Build Your Reputation
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            After completing your exchange, submit constructive reviews and unlock verified achievement badges that showcase your teaching ability on your student profile.
          </p>
          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
            ⭐ <em>Peer reviews validate your communication and mastery for future internships.</em>
          </div>
        </div>
      </div>

      {/* FAQs */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 space-y-6">
        <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm">
          <HelpCircle className="w-5 h-5" />
          <span>Frequently Asked Questions</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {faqs.map((faq, idx) => (
            <div key={idx} className="space-y-1.5">
              <h4 className="text-sm font-bold text-slate-900">{faq.q}</h4>
              <p className="text-xs text-slate-600 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center pt-4">
        <Link
          to="/register"
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-md shadow-indigo-600/20"
        >
          Create Your Student Profile
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};
