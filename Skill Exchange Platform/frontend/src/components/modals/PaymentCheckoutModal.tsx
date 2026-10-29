import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { PaymentMethodType, PaymentDetails, PaymentTransaction } from '../../types';
import { 
  CreditCard, 
  Smartphone, 
  Wallet, 
  Building2, 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  Lock, 
  ArrowRight, 
  RefreshCw, 
  Sparkles, 
  QrCode, 
  Clock, 
  FileText,
  AlertCircle,
  HelpCircle,
  ChevronRight,
  Info
} from 'lucide-react';

export const PaymentCheckoutModal: React.FC = () => {
  const { 
    currentUser, 
    checkoutModalOpen, 
    checkoutOptions, 
    closeCheckout, 
    processPayment, 
    walletBalance, 
    openReceiptModal 
  } = useApp();

  const [activeTab, setActiveTab] = useState<PaymentMethodType>('card');

  // Card form state
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [cardName, setCardName] = useState(currentUser?.name || 'Pranav Patel');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvv, setCardCvv] = useState('123');
  const [cardBrand, setCardBrand] = useState<'Visa' | 'Mastercard' | 'Amex' | 'RuPay'>('Visa');

  // UPI state
  const [upiId, setUpiId] = useState('pranav@okhdfcbank');
  const [qrCountdown, setQrCountdown] = useState(300); // 5 mins

  // Netbanking state
  const [selectedBank, setSelectedBank] = useState('HDFC Bank');

  // Sandbox simulation settings
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [simulate3DSecure, setSimulate3DSecure] = useState(false);

  // Flow states: 'input' | 'processing' | 'otp' | 'success' | 'failed'
  const [flowState, setFlowState] = useState<'input' | 'processing' | 'otp' | 'success' | 'failed'>('input');
  const [processingStep, setProcessingStep] = useState(1);
  const [otpCode, setOtpCode] = useState('');
  const [lastTransaction, setLastTransaction] = useState<PaymentTransaction | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Reset modal state on open
  useEffect(() => {
    if (checkoutModalOpen) {
      setFlowState('input');
      setProcessingStep(1);
      setOtpCode('');
      setLastTransaction(null);
      setErrorMessage('');
      setSimulateFailure(false);
      setQrCountdown(300);

      // Default tab based on options: if purpose is wallet_topup, don't default to wallet
      if (checkoutOptions?.purpose === 'wallet_topup') {
        setActiveTab('card');
      } else if (walletBalance >= (checkoutOptions?.amount || 0)) {
        setActiveTab('wallet');
      } else {
        setActiveTab('card');
      }
    }
  }, [checkoutModalOpen, checkoutOptions, walletBalance]);

  // Card Brand Detection
  useEffect(() => {
    const rawNum = cardNumber.replace(/\s+/g, '');
    if (rawNum.startsWith('4')) {
      setCardBrand('Visa');
    } else if (rawNum.startsWith('5')) {
      setCardBrand('Mastercard');
    } else if (rawNum.startsWith('3')) {
      setCardBrand('Amex');
    } else if (rawNum.startsWith('6')) {
      setCardBrand('RuPay');
    } else {
      setCardBrand('Visa');
    }
  }, [cardNumber]);

  // QR Countdown timer
  useEffect(() => {
    if (checkoutModalOpen && activeTab === 'upi' && flowState === 'input') {
      const timer = setInterval(() => {
        setQrCountdown(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [checkoutModalOpen, activeTab, flowState]);

  if (!checkoutModalOpen || !checkoutOptions) return null;

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 16);
    const formatted = val.replace(/(\d{4})(?=\d)/g, '$1 ');
    setCardNumber(formatted);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (val.length >= 3) {
      val = `${val.slice(0, 2)}/${val.slice(2)}`;
    }
    setCardExpiry(val);
  };

  const autofillCard = (type: 'visa' | 'mastercard' | 'decline') => {
    if (type === 'visa') {
      setCardNumber('4242 4242 4242 4242');
      setCardBrand('Visa');
      setCardExpiry('12/28');
      setCardCvv('789');
      setSimulateFailure(false);
    } else if (type === 'mastercard') {
      setCardNumber('5555 5555 5555 4444');
      setCardBrand('Mastercard');
      setCardExpiry('09/27');
      setCardCvv('456');
      setSimulateFailure(false);
    } else if (type === 'decline') {
      setCardNumber('4000 0000 0000 0002');
      setCardExpiry('01/25');
      setCardCvv('000');
      setSimulateFailure(true);
    }
  };

  // Execution of payment
  const startPaymentExecution = async () => {
    if (activeTab === 'card') {
      if (cardNumber.replace(/\s+/g, '').length < 15) {
        setErrorMessage('Please enter a valid card number.');
        return;
      }
      if (!cardExpiry || cardExpiry.length < 5) {
        setErrorMessage('Please enter a valid MM/YY expiry.');
        return;
      }
    }

    if (activeTab === 'upi' && !upiId.includes('@')) {
      setErrorMessage('Please enter a valid UPI ID (e.g. user@okhdfcbank).');
      return;
    }

    setErrorMessage('');

    if (simulate3DSecure) {
      setFlowState('otp');
      return;
    }

    await executeFinalPayment();
  };

  const executeFinalPayment = async () => {
    setFlowState('processing');
    setProcessingStep(1);

    // Step 1: Securing connection
    await new Promise(r => setTimeout(r, 700));
    setProcessingStep(2);

    // Step 2: Gateway authorization
    await new Promise(r => setTimeout(r, 800));
    setProcessingStep(3);

    // Step 3: Confirmation
    await new Promise(r => setTimeout(r, 600));

    let paymentDetails: PaymentDetails = {};
    if (activeTab === 'card') {
      paymentDetails = {
        cardBrand,
        cardLast4: cardNumber.replace(/\s+/g, '').slice(-4) || '4242'
      };
    } else if (activeTab === 'upi') {
      paymentDetails = {
        upiId: upiId || 'pranav@okhdfcbank'
      };
    } else if (activeTab === 'netbanking') {
      paymentDetails = {
        bankName: selectedBank
      };
    }

    const result = await processPayment({
      method: activeTab,
      paymentDetails,
      simulateFailure,
      failureReason: simulateFailure ? 'Card declined by issuing bank (Demo Failure Test).' : undefined
    });

    if (result.success && result.transaction) {
      setLastTransaction(result.transaction);
      setFlowState('success');
    } else {
      setLastTransaction(result.transaction || null);
      setErrorMessage(result.error || 'Payment failed.');
      setFlowState('failed');
    }
  };

  const popularBanks = [
    { name: 'HDFC Bank', code: 'HDFC', badge: 'Fastest' },
    { name: 'ICICI Bank', code: 'ICICI', badge: 'Instant' },
    { name: 'State Bank of India', code: 'SBI', badge: 'Zero Fee' },
    { name: 'Chase Bank', code: 'CHASE', badge: 'Popular' },
    { name: 'Bank of America', code: 'BOA', badge: 'Supported' },
    { name: 'Axis Bank', code: 'AXIS', badge: 'Supported' },
  ];

  const formatCountdown = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <Modal 
      isOpen={checkoutModalOpen} 
      onClose={closeCheckout} 
      title="SkillBridge Demo Checkout"
      description="Simulated 256-Bit SSL Payment Gateway (Sandbox Mode)"
      maxWidth="xl"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 rounded-full">
                Demo Payment Sandbox
              </span>
              <span className="text-[10px] text-slate-400">
                256-Bit SSL Mock Gateway
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight mt-1">
              {checkoutOptions.title}
            </h2>
            {checkoutOptions.description && (
              <p className="text-xs text-slate-500 mt-0.5">
                {checkoutOptions.description}
              </p>
            )}
          </div>

          <div className="text-right">
            <span className="text-[11px] font-semibold text-slate-400 block uppercase">
              Amount Due
            </span>
            <span className="text-2xl font-black text-slate-900">
              ${checkoutOptions.amount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* FLOW STATE: INPUT */}
        {flowState === 'input' && (
          <div className="space-y-6">
            {/* Method Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-slate-100/90 rounded-2xl">
              <button
                type="button"
                onClick={() => setActiveTab('card')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'card'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Card</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('upi')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'upi'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>UPI / QR</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('wallet')}
                disabled={checkoutOptions.purpose === 'wallet_topup'}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'wallet'
                    ? 'bg-white text-amber-700 shadow-xs'
                    : checkoutOptions.purpose === 'wallet_topup'
                    ? 'text-slate-300 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Wallet className="w-4 h-4" />
                <span>Wallet</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('netbanking')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'netbanking'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Net Banking</span>
              </button>
            </div>

            {/* TAB 1: CARD */}
            {activeTab === 'card' && (
              <div className="space-y-4">
                {/* Interactive 3D Card Preview */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-tr from-slate-900 via-indigo-950 to-indigo-900 p-6 text-white shadow-lg border border-slate-700/60">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-7 rounded-md bg-amber-400/80 border border-amber-300 flex items-center justify-center shadow-inner">
                        <div className="w-6 h-4 border border-amber-600/40 rounded-xs" />
                      </div>
                      <div className="text-[10px] text-indigo-300 tracking-wider uppercase font-semibold">
                        SkillBridge Sandbox Card
                      </div>
                    </div>
                    <span className="font-extrabold text-base tracking-widest text-indigo-200">
                      {cardBrand.toUpperCase()}
                    </span>
                  </div>

                  <div className="font-mono text-xl sm:text-2xl tracking-[0.2em] font-semibold text-slate-100 my-4 tabular-nums">
                    {cardNumber || '•••• •••• •••• ••••'}
                  </div>

                  <div className="flex items-end justify-between text-xs tracking-wider pt-2">
                    <div>
                      <div className="text-[9px] uppercase text-indigo-300 font-medium">Cardholder</div>
                      <div className="font-bold truncate max-w-[180px] uppercase text-slate-100">
                        {cardName || 'STUDENT NAME'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-indigo-300 font-medium">Expires</div>
                      <div className="font-bold font-mono text-slate-100">
                        {cardExpiry || 'MM/YY'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Autofill Presets */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] font-semibold text-slate-400">
                    Quick Demo Presets:
                  </span>
                  <button
                    type="button"
                    onClick={() => autofillCard('visa')}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/70 transition-colors"
                  >
                    ⚡ Visa (Success)
                  </button>
                  <button
                    type="button"
                    onClick={() => autofillCard('mastercard')}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/70 transition-colors"
                  >
                    ⚡ Mastercard
                  </button>
                  <button
                    type="button"
                    onClick={() => autofillCard('decline')}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200/70 transition-colors"
                  >
                    ⚡ Test Decline (4000)
                  </button>
                </div>

                {/* Inputs */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Card Number
                    </label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={handleCardNumberChange}
                      placeholder="1234 5678 9012 3456"
                      className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Name on Card
                      </label>
                      <input
                        type="text"
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder="Full Name"
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Expires (MM/YY)
                      </label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={handleExpiryChange}
                        placeholder="MM/YY"
                        maxLength={5}
                        className="w-full px-3.5 py-2.5 text-xs font-mono text-center rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        CVV / CVC
                      </label>
                      <input
                        type="password"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.slice(0, 4))}
                        placeholder="•••"
                        maxLength={4}
                        className="w-full px-3.5 py-2.5 text-xs font-mono text-center rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: UPI / QR */}
            {activeTab === 'upi' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200/80">
                  {/* Dynamic SVG QR Pattern */}
                  <div className="sm:col-span-5 flex flex-col items-center">
                    <div className="p-3 bg-white rounded-2xl shadow-sm border border-emerald-200 text-center">
                      <svg
                        className="w-36 h-36 mx-auto text-slate-900"
                        viewBox="0 0 100 100"
                        fill="currentColor"
                      >
                        {/* Position Markers */}
                        <rect x="5" y="5" width="26" height="26" rx="4" fill="#047857" />
                        <rect x="9" y="9" width="18" height="18" rx="2" fill="#ffffff" />
                        <rect x="13" y="13" width="10" height="10" rx="1" fill="#047857" />

                        <rect x="69" y="5" width="26" height="26" rx="4" fill="#047857" />
                        <rect x="73" y="9" width="18" height="18" rx="2" fill="#ffffff" />
                        <rect x="77" y="13" width="10" height="10" rx="1" fill="#047857" />

                        <rect x="5" y="69" width="26" height="26" rx="4" fill="#047857" />
                        <rect x="9" y="73" width="18" height="18" rx="2" fill="#ffffff" />
                        <rect x="13" y="77" width="10" height="10" rx="1" fill="#047857" />

                        {/* Pixel matrix simulated dots */}
                        <rect x="36" y="8" width="5" height="5" />
                        <rect x="46" y="8" width="5" height="5" />
                        <rect x="56" y="8" width="5" height="5" />
                        <rect x="36" y="18" width="5" height="5" />
                        <rect x="46" y="24" width="5" height="5" />
                        <rect x="56" y="18" width="5" height="5" />
                        <rect x="8" y="36" width="5" height="5" />
                        <rect x="18" y="36" width="5" height="5" />
                        <rect x="28" y="36" width="5" height="5" />
                        <rect x="8" y="46" width="5" height="5" />
                        <rect x="22" y="46" width="5" height="5" />
                        <rect x="8" y="56" width="5" height="5" />
                        <rect x="28" y="56" width="5" height="5" />
                        <rect x="38" y="38" width="10" height="10" fill="#047857" />
                        <rect x="52" y="38" width="10" height="10" />
                        <rect x="38" y="52" width="10" height="10" />
                        <rect x="52" y="52" width="10" height="10" fill="#047857" />
                        <rect x="68" y="36" width="5" height="5" />
                        <rect x="78" y="42" width="5" height="5" />
                        <rect x="88" y="36" width="5" height="5" />
                        <rect x="68" y="52" width="5" height="5" />
                        <rect x="80" y="56" width="5" height="5" />
                        <rect x="36" y="68" width="5" height="5" />
                        <rect x="46" y="74" width="5" height="5" />
                        <rect x="56" y="68" width="5" height="5" />
                        <rect x="36" y="82" width="5" height="5" />
                        <rect x="46" y="86" width="5" height="5" />
                        <rect x="56" y="82" width="5" height="5" />
                        <rect x="68" y="68" width="5" height="5" />
                        <rect x="86" y="72" width="5" height="5" />
                        <rect x="76" y="82" width="5" height="5" />
                        <rect x="86" y="86" width="5" height="5" />
                      </svg>
                      <span className="text-[10px] text-slate-500 font-medium block mt-1">
                        Scan with any UPI app
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-semibold mt-2">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Expires in {formatCountdown(qrCountdown)}</span>
                    </div>
                  </div>

                  {/* QR Details & Quick Actions */}
                  <div className="sm:col-span-7 space-y-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        Scan & Pay from PhonePe, GPay, Paytm
                      </h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Scan the sandbox QR code or click below to simulate instant phone payment authorization.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => executeFinalPayment()}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-xl transition-colors shadow-xs"
                    >
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      Simulate Instant Mobile QR Scan & Approve
                    </button>

                    <div className="pt-2 border-t border-emerald-200/60">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Or Enter UPI Virtual Address (VPA)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={upiId}
                          onChange={(e) => setUpiId(e.target.value)}
                          placeholder="yourname@okhdfcbank"
                          className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-500">
                        <span>Presets:</span>
                        <button
                          type="button"
                          onClick={() => setUpiId('pranav@okhdfcbank')}
                          className="text-indigo-600 hover:underline"
                        >
                          pranav@okhdfcbank
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => setUpiId('demo.student@paytm')}
                          className="text-indigo-600 hover:underline"
                        >
                          demo.student@paytm
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: WALLET */}
            {activeTab === 'wallet' && (
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                      <Wallet className="w-6 h-6" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                        SkillBridge Available Balance
                      </span>
                      <div className="text-2xl font-black text-slate-900">
                        ${walletBalance.toFixed(2)}
                      </div>
                      <span className="text-xs text-slate-500">
                        Zero transaction fees on wallet credits
                      </span>
                    </div>
                  </div>

                  <div className="text-center sm:text-right">
                    {walletBalance >= checkoutOptions.amount ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-emerald-700 bg-emerald-100">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Sufficient Balance
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-rose-700 bg-rose-100">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Requires ${(checkoutOptions.amount - walletBalance).toFixed(2)} more
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-600 bg-white p-4 rounded-xl border border-slate-200 space-y-1">
                  <div className="font-semibold text-slate-800">
                    How SkillBridge Wallet Works:
                  </div>
                  <p>
                    Earn credits whenever you host peer tutoring sessions, or top-up your balance anytime. Wallet credits can be used instantly without entering card details.
                  </p>
                </div>
              </div>
            )}

            {/* TAB 4: NET BANKING */}
            {activeTab === 'netbanking' && (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Select Your Bank
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {popularBanks.map((bank) => {
                    const isSelected = selectedBank === bank.name;
                    return (
                      <button
                        key={bank.name}
                        type="button"
                        onClick={() => setSelectedBank(bank.name)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-500'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <Building2 className={`w-4 h-4 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-100/60 px-1.5 py-0.2 rounded">
                            {bank.badge}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-slate-800 truncate">
                          {bank.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          NetBanking Gateway
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Sandbox Simulation Bar */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Sandbox Testing Controls
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Demo Simulation Environment
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulateFailure}
                    onChange={(e) => setSimulateFailure(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                  />
                  <span>Simulate Payment Failure / Decline</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulate3DSecure}
                    onChange={(e) => setSimulate3DSecure(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                  />
                  <span>Require 3D Secure / OTP Challenge</span>
                </label>
              </div>
            </div>

            {/* Submit Action Button */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={closeCheckout}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={startPaymentExecution}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-md shadow-indigo-600/20"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  Pay ${checkoutOptions.amount.toFixed(2)} via {activeTab.toUpperCase()}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* FLOW STATE: OTP 3D SECURE CHALLENGE */}
        {flowState === 'otp' && (
          <div className="py-6 px-4 space-y-6 text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center border border-indigo-200">
              <Lock className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-900">
                3D Secure Verification
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                A one-time simulated password has been dispatched to your registered mobile device ending in <span className="font-semibold text-slate-700">••89</span>.
              </p>
            </div>

            <div className="max-w-xs mx-auto space-y-3">
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.slice(0, 6))}
                placeholder="Enter 6-digit OTP"
                className="w-full text-center tracking-[0.5em] font-mono text-xl py-3 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white"
              />

              <button
                type="button"
                onClick={() => setOtpCode('123456')}
                className="text-[11px] font-semibold text-indigo-600 hover:underline"
              >
                ⚡ Auto-fill demo OTP (123456)
              </button>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFlowState('input')}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeFinalPayment()}
                disabled={otpCode.length < 4}
                className="px-6 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
              >
                Verify & Complete Payment
              </button>
            </div>
          </div>
        )}

        {/* FLOW STATE: PROCESSING ANIMATION */}
        {flowState === 'processing' && (
          <div className="py-12 px-4 text-center space-y-6">
            <div className="relative w-16 h-16 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-200 animate-ping opacity-40" />
              <div className="w-16 h-16 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin flex items-center justify-center">
                <Lock className="w-6 h-6 text-indigo-600" />
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">
                Processing Demo Payment...
              </h3>
              <p className="text-xs text-slate-500">
                Please do not close this window or navigate away.
              </p>
            </div>

            {/* Checklist */}
            <div className="max-w-xs mx-auto text-left space-y-2 text-xs">
              <div className={`flex items-center gap-2 ${processingStep >= 1 ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Securing SSL encrypted connection</span>
              </div>
              <div className={`flex items-center gap-2 ${processingStep >= 2 ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Authorizing with sandbox payment network</span>
              </div>
              <div className={`flex items-center gap-2 ${processingStep >= 3 ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Confirming transaction & balance</span>
              </div>
            </div>
          </div>
        )}

        {/* FLOW STATE: SUCCESS */}
        {flowState === 'success' && lastTransaction && (
          <div className="py-8 px-4 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center border-2 border-emerald-200 shadow-sm animate-in zoom-in-75 duration-200">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                Transaction Successful
              </span>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                ${lastTransaction.amount.toFixed(2)} Paid
              </h3>
              <p className="text-xs text-slate-500">
                {lastTransaction.title}
              </p>
            </div>

            {/* Summary Box */}
            <div className="max-w-md mx-auto p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-left text-xs space-y-2">
              <div className="flex justify-between text-slate-500">
                <span>Transaction ID:</span>
                <span className="font-mono text-slate-800 font-bold">{lastTransaction.id}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Payment Method:</span>
                <span className="font-semibold text-slate-800 uppercase">{lastTransaction.paymentMethod}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Timestamp:</span>
                <span className="text-slate-800 font-medium">{new Date(lastTransaction.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="flex justify-between text-slate-500 pt-2 border-t border-slate-200">
                <span>Updated Wallet Balance:</span>
                <span className="font-bold text-emerald-700">${walletBalance.toFixed(2)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  closeCheckout();
                  openReceiptModal(lastTransaction);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>View Digital Receipt / Invoice</span>
              </button>

              <button
                type="button"
                onClick={closeCheckout}
                className="px-6 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* FLOW STATE: FAILED */}
        {flowState === 'failed' && (
          <div className="py-8 px-4 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-rose-100 text-rose-600 mx-auto flex items-center justify-center border-2 border-rose-200 shadow-sm">
              <XCircle className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full">
                Payment Declined
              </span>
              <h3 className="text-xl font-bold text-slate-900 tracking-tight mt-1">
                Unable to Process Payment
              </h3>
              <p className="text-xs text-rose-600 max-w-sm mx-auto">
                {errorMessage || 'The demo card was declined by the simulated sandbox gateway.'}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-500 max-w-sm mx-auto text-left space-y-1">
              <div className="font-semibold text-slate-700">Sandbox Testing Note:</div>
              <p>
                You can retry with a valid demo card (e.g. 4242...), uncheck "Simulate Failure", or try UPI / Wallet payment.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={closeCheckout}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setSimulateFailure(false);
                  setFlowState('input');
                  setErrorMessage('');
                }}
                className="inline-flex items-center gap-1.5 px-6 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Payment</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
