import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentPurpose, PaymentTransaction, SubscriptionPlan } from '../../types';
import { 
  Wallet, 
  CreditCard, 
  Sparkles, 
  ArrowUpRight, 
  ArrowDownLeft, 
  ArrowRight,
  ShieldCheck, 
  CheckCircle2, 
  RotateCcw, 
  FileText, 
  Search, 
  Filter, 
  Plus, 
  Crown, 
  Zap, 
  Gift, 
  Check, 
  ChevronRight, 
  RefreshCw,
  Clock,
  Smartphone,
  Building2,
  XCircle,
  AlertCircle
} from 'lucide-react';

export const PaymentsPage: React.FC = () => {
  const { 
    currentUser, 
    walletBalance, 
    subscription, 
    transactions, 
    topUpWallet, 
    subscribeToPro, 
    cancelSubscription, 
    openReceiptModal, 
    refundTransaction, 
    resetDemoData,
    openCheckout
  } = useApp();

  const [activeTab, setActiveTab] = useState<'all' | PaymentPurpose>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [customTopupAmount, setCustomTopupAmount] = useState('');
  const [showCustomTopup, setShowCustomTopup] = useState(false);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const matchesTab = activeTab === 'all' || t.purpose === activeTab;
      const matchesQuery = 
        t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.recipientName && t.recipientName.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesTab && matchesQuery;
    });
  }, [transactions, activeTab, searchQuery]);

  // Financial Stats
  const totalTopUps = useMemo(() => {
    return transactions
      .filter(t => t.purpose === 'wallet_topup' && t.status === 'completed')
      .reduce((acc, t) => acc + t.amount, 0);
  }, [transactions]);

  const totalSpent = useMemo(() => {
    return transactions
      .filter(t => t.purpose !== 'wallet_topup' && t.status === 'completed')
      .reduce((acc, t) => acc + t.amount, 0);
  }, [transactions]);

  const handleCustomTopupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(customTopupAmount);
    if (!isNaN(parsed) && parsed > 0) {
      topUpWallet(parsed);
      setCustomTopupAmount('');
      setShowCustomTopup(false);
    }
  };

  const getMethodIcon = (method: PaymentTransaction['paymentMethod']) => {
    switch (method) {
      case 'card':
        return <CreditCard className="w-3.5 h-3.5 text-indigo-600" />;
      case 'upi':
        return <Smartphone className="w-3.5 h-3.5 text-emerald-600" />;
      case 'wallet':
        return <Wallet className="w-3.5 h-3.5 text-amber-600" />;
      case 'netbanking':
        return <Building2 className="w-3.5 h-3.5 text-blue-600" />;
    }
  };

  const getPurposeBadge = (purpose: PaymentPurpose) => {
    switch (purpose) {
      case 'wallet_topup':
        return <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold">Top-Up</span>;
      case 'pro_subscription':
        return <span className="bg-purple-50 text-purple-700 border border-purple-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold">Pro Plan</span>;
      case 'session_booking':
        return <span className="bg-indigo-50 text-indigo-700 border border-indigo-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold">Session</span>;
      case 'mentor_tip':
        return <span className="bg-rose-50 text-rose-700 border border-rose-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold">Mentor Tip</span>;
    }
  };

  const isPro = subscription.plan !== 'free';

  return (
    <div className="space-y-8 pb-12">
      {/* Top Welcome & Sandbox Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Payments & Wallet
            </h1>
            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full">
              Demo Sandbox
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage your peer learning credits, Pro student membership, and transaction records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset all demo balances and payment transactions to factory state?')) {
                resetDemoData();
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Demo Data</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: WALLET & OVERVIEW CARDS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Digital Wallet Card */}
        <div className="lg:col-span-7 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl border border-slate-800 relative overflow-hidden flex flex-col justify-between min-h-[260px]">
          <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Card Top */}
          <div className="flex items-start justify-between relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider block">
                  SkillBridge Campus Wallet
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  {currentUser?.college || 'Stanford University'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Sandbox Live</span>
            </div>
          </div>

          {/* Card Center: Balance */}
          <div className="my-6 relative z-10">
            <span className="text-xs text-indigo-300/90 font-medium uppercase tracking-wider block">
              Available Learning Credits
            </span>
            <div className="text-4xl sm:text-5xl font-black tracking-tight text-white mt-1 tabular-nums">
              ${walletBalance.toFixed(2)}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              1 Credit = $1.00 USD · Free instant transfers for peer tutoring
            </span>
          </div>

          {/* Card Bottom: Quick Top-Up Pills */}
          <div className="pt-4 border-t border-slate-800 relative z-10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-indigo-300 mr-1">
                Quick Top-Up:
              </span>
              {[10, 25, 50, 100].map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => topUpWallet(amt)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/40 border border-indigo-400/30 text-xs font-bold text-white transition-colors"
                >
                  +${amt}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomTopup(!showCustomTopup)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors"
              >
                Custom
              </button>
            </div>

            <button
              type="button"
              onClick={() => topUpWallet(25)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-xl transition-colors shadow-xs ml-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Funds</span>
            </button>
          </div>

          {/* Custom Topup Drawer */}
          {showCustomTopup && (
            <form onSubmit={handleCustomTopupSubmit} className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 relative z-10">
              <span className="text-xs font-bold text-slate-400">$</span>
              <input
                type="text"
                value={customTopupAmount}
                onChange={(e) => setCustomTopupAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Enter custom amount (e.g. 75)"
                className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-800 text-white border border-slate-700 focus:outline-hidden focus:border-indigo-400"
                autoFocus
              />
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"
              >
                Continue
              </button>
            </form>
          )}
        </div>

        {/* Right: Membership Status Card */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Membership Tier
              </span>
              {isPro ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  <Crown className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                  Active Pro Member
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  Free Student Tier
                </span>
              )}
            </div>

            <div>
              <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                {isPro ? 'SkillBridge Pro Unlocked' : 'Upgrade to SkillBridge Pro'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {isPro
                  ? `Your Pro subscription is active with priority algorithmic matching, tutor badges, and session summaries.`
                  : 'Get 3x profile visibility, priority match recommendations, and verified tutor credentials.'}
              </p>
            </div>

            {/* Perks list */}
            <div className="space-y-2 pt-1 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>3x Boost in Peer Search Algorithm</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>Verified Peer Tutor Credential Badge</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span>Unlimited 1-on-1 Fast-Track Exchange Proposals</span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 mt-4 flex items-center justify-between gap-3">
            {isPro ? (
              <>
                <div className="text-[11px] text-slate-500">
                  Renews: <span className="font-semibold text-slate-800">
                    {subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString() : 'Next Month'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={cancelSubscription}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                >
                  Cancel Subscription
                </button>
              </>
            ) : (
              <div className="w-full flex items-center justify-between gap-3">
                <div>
                  <span className="text-base font-extrabold text-slate-900">$9.99</span>
                  <span className="text-xs text-slate-500"> / month</span>
                </div>
                <button
                  type="button"
                  onClick={() => subscribeToPro('pro_monthly')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Upgrade to Pro</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2: PRO PLANS CAROUSEL / COMPARISON (IF NOT PRO) */}
      {!isPro && (
        <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-slate-50 rounded-3xl p-6 sm:p-8 border border-indigo-100 space-y-6">
          <div className="max-w-2xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100/70 px-2.5 py-0.5 rounded-full">
              Student Pricing Plans
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-2">
              Accelerate Your Peer Learning Journey
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Test full demo checkout with zero real charges. Free forever for standard peer exchange, or upgrade to Pro for priority pairing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Monthly Plan */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-base">Monthly Pro Pass</h3>
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Flexible</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900">$9.99</span>
                  <span className="text-xs text-slate-500">/ month</span>
                </div>
                <p className="text-xs text-slate-500">
                  Ideal for students preparing for semester exams and technical interview prep.
                </p>
              </div>

              <button
                type="button"
                onClick={() => subscribeToPro('pro_monthly')}
                className="w-full py-2.5 px-4 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors"
              >
                Choose Monthly ($9.99)
              </button>
            </div>

            {/* Semester Pass */}
            <div className="bg-white rounded-2xl p-6 border-2 border-indigo-600 shadow-md relative flex flex-col justify-between space-y-4">
              <div className="absolute -top-3 right-6 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-xs">
                Best Value · Save 50%
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-base">Semester Pass (6 Months)</h3>
                  <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">Popular</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900">$29.99</span>
                  <span className="text-xs text-slate-500">/ 6 months ($5.00/mo)</span>
                </div>
                <p className="text-xs text-slate-500">
                  Full semester access including AI lesson transcripts and official skill completion diplomas.
                </p>
              </div>

              <button
                type="button"
                onClick={() => subscribeToPro('pro_semester')}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
              >
                Get Semester Pass ($29.99)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: TRANSACTION HISTORY */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Table Header & Filters */}
        <div className="p-6 border-b border-slate-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Transaction History
              </h2>
              <p className="text-xs text-slate-500">
                View all wallet top-ups, paid mentorships, tips, and invoices.
              </p>
            </div>

            {/* Search input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ID or title..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-slate-50"
              />
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {[
              { id: 'all', label: 'All Transactions' },
              { id: 'wallet_topup', label: 'Wallet Top-ups' },
              { id: 'pro_subscription', label: 'Pro Subscriptions' },
              { id: 'session_booking', label: 'Session Bookings' },
              { id: 'mentor_tip', label: 'Mentor Tips' },
            ].map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 text-xs rounded-xl font-semibold transition-all ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Transactions Table */}
        {filteredTransactions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <div className="text-sm font-bold text-slate-800">No Transactions Found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              There are no transactions matching your current filter. You can add test funds using the top-up buttons above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-5">Transaction ID</th>
                  <th className="py-3 px-5">Type</th>
                  <th className="py-3 px-5">Description</th>
                  <th className="py-3 px-5">Payment Method</th>
                  <th className="py-3 px-5 text-right">Amount</th>
                  <th className="py-3 px-5 text-center">Status</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredTransactions.map((tx) => {
                  const isCredit = tx.purpose === 'wallet_topup';
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-5 font-mono font-bold text-slate-900">
                        {tx.id}
                        <div className="text-[10px] text-slate-400 font-normal">
                          {new Date(tx.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </td>

                      <td className="py-3.5 px-5">
                        {getPurposeBadge(tx.purpose)}
                      </td>

                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-800">
                          {tx.title}
                        </div>
                        {tx.recipientName && (
                          <div className="text-[11px] text-indigo-600 font-medium">
                            To: {tx.recipientName}
                          </div>
                        )}
                        {tx.description && (
                          <div className="text-[11px] text-slate-500 truncate max-w-xs">
                            {tx.description}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-1.5 font-medium text-slate-700 capitalize">
                          {getMethodIcon(tx.paymentMethod)}
                          <span>{tx.paymentMethod}</span>
                          {tx.paymentDetails.cardLast4 && (
                            <span className="text-[10px] text-slate-400">
                              (•••• {tx.paymentDetails.cardLast4})
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-5 text-right font-black tabular-nums">
                        <span className={isCredit ? 'text-emerald-600' : 'text-slate-900'}>
                          {isCredit ? '+' : '-'}${tx.amount.toFixed(2)}
                        </span>
                      </td>

                      <td className="py-3.5 px-5 text-center">
                        {tx.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Completed
                          </span>
                        )}
                        {tx.status === 'refunded' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200">
                            <RotateCcw className="w-3 h-3 text-amber-600" />
                            Refunded
                          </span>
                        )}
                        {tx.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            Failed
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openReceiptModal(tx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="View official digital receipt"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Receipt</span>
                          </button>

                          {tx.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Simulate refund for transaction ${tx.id}?`)) {
                                  refundTransaction(tx.id);
                                }
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                              title="Test Sandbox Refund"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 4: SANDBOX DEMO TESTING PLAYGROUND */}
      <div className="p-6 rounded-3xl bg-slate-900 text-white space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              Demo Sandbox Testing Playground
            </h3>
          </div>
          <span className="text-[10px] text-slate-400">
            Simulate realistic payment flows
          </span>
        </div>

        <p className="text-xs text-slate-300">
          Click any scenario below to open the checkout flow and test instant card validation, UPI QR scanning, wallet debit, or simulated bank declines.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <button
            type="button"
            onClick={() => topUpWallet(50)}
            className="p-3 rounded-2xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-left transition-colors flex items-center justify-between"
          >
            <div>
              <div className="text-xs font-bold text-white">Test $50 Wallet Top-Up</div>
              <div className="text-[10px] text-slate-400">Card, UPI, or Net Banking</div>
            </div>
            <ArrowRight className="w-4 h-4 text-indigo-400" />
          </button>

          <button
            type="button"
            onClick={() => subscribeToPro('pro_monthly')}
            className="p-3 rounded-2xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-left transition-colors flex items-center justify-between"
          >
            <div>
              <div className="text-xs font-bold text-white">Test Pro Upgrade ($9.99)</div>
              <div className="text-[10px] text-slate-400">Activates Pro membership badge</div>
            </div>
            <Crown className="w-4 h-4 text-amber-400" />
          </button>

          <button
            type="button"
            onClick={() => {
              openCheckout({
                amount: 15.00,
                title: 'Test 1-on-1 Mentorship Booking',
                purpose: 'session_booking',
                description: 'Sandbox test booking for peer mentorship consultation.'
              });
            }}
            className="p-3 rounded-2xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-left transition-colors flex items-center justify-between"
          >
            <div>
              <div className="text-xs font-bold text-white">Test $15 Session Booking</div>
              <div className="text-[10px] text-slate-400">Supports 1-click wallet pay</div>
            </div>
            <ArrowRight className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </div>
    </div>
  );
};
