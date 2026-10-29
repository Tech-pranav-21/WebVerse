import React from 'react';
import { Modal } from '../common/Modal';
import { PaymentTransaction } from '../../types';
import { useApp } from '../../context/AppContext';
import { 
  CheckCircle2, 
  Printer, 
  RotateCcw, 
  X, 
  Download, 
  ShieldCheck, 
  CreditCard, 
  Smartphone, 
  Wallet, 
  Building2,
  GraduationCap
} from 'lucide-react';

interface InvoiceReceiptModalProps {
  transaction: PaymentTransaction | null;
  isOpen: boolean;
  onClose: () => void;
}

export const InvoiceReceiptModal: React.FC<InvoiceReceiptModalProps> = ({
  transaction,
  isOpen,
  onClose
}) => {
  const { currentUser, refundTransaction } = useApp();

  if (!transaction) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = new Date(transaction.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const getMethodIcon = () => {
    switch (transaction.paymentMethod) {
      case 'card':
        return <CreditCard className="w-4 h-4 text-indigo-600" />;
      case 'upi':
        return <Smartphone className="w-4 h-4 text-emerald-600" />;
      case 'wallet':
        return <Wallet className="w-4 h-4 text-amber-600" />;
      case 'netbanking':
        return <Building2 className="w-4 h-4 text-blue-600" />;
    }
  };

  const getMethodLabel = () => {
    switch (transaction.paymentMethod) {
      case 'card':
        return `${transaction.paymentDetails.cardBrand || 'Card'} •••• ${transaction.paymentDetails.cardLast4 || '4242'}`;
      case 'upi':
        return `UPI (${transaction.paymentDetails.upiId || 'Instant Pay'})`;
      case 'wallet':
        return 'SkillBridge Student Wallet';
      case 'netbanking':
        return `Net Banking (${transaction.paymentDetails.bankName || 'Bank'})`;
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Official Receipt & Invoice"
      description={`Transaction ${transaction.id} · Invoice #${transaction.invoiceNumber}`}
      maxWidth="lg"
    >
      <div className="space-y-6 print:p-0">

        {/* Status Stamp & Summary Card */}
        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Total Amount Paid
            </span>
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
              {transaction.currency}{transaction.amount.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500">
              Transaction ID: <span className="font-mono text-slate-700 font-semibold">{transaction.id}</span>
            </div>
          </div>

          <div className="flex flex-col items-center sm:items-end gap-1.5">
            {transaction.status === 'completed' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-700 bg-emerald-100/90 border border-emerald-300 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                PAYMENT COMPLETED
              </span>
            )}
            {transaction.status === 'refunded' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-amber-700 bg-amber-100/90 border border-amber-300 rounded-full">
                <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                REFUNDED
              </span>
            )}
            {transaction.status === 'failed' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-rose-700 bg-rose-100/90 border border-rose-300 rounded-full">
                PAYMENT FAILED
              </span>
            )}
            <span className="text-[11px] text-slate-400">
              Invoice #{transaction.invoiceNumber}
            </span>
          </div>
        </div>

        {/* Invoice Meta Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl border border-slate-100 bg-white space-y-1.5">
            <span className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">
              Billed To (Student)
            </span>
            <div className="font-bold text-slate-800 text-sm">
              {currentUser?.name || 'Pranav Patel'}
            </div>
            <div className="text-slate-500">
              {currentUser?.email || 'pranav.patel@stanford.edu'}
            </div>
            <div className="text-slate-500">
              {currentUser?.college || 'Stanford University'}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-100 bg-white space-y-1.5">
            <span className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">
              Payment Details
            </span>
            <div className="flex items-center gap-2 text-slate-800 font-semibold">
              {getMethodIcon()}
              <span>{getMethodLabel()}</span>
            </div>
            <div className="text-slate-500">
              Date: {formattedDate}
            </div>
            <div className="text-slate-500 flex items-center gap-1 text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>Simulated 256-Bit SSL Demo Sandbox</span>
            </div>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="border border-slate-200/90 rounded-2xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/80 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4">Item & Description</th>
                <th className="py-2.5 px-4 text-right">Qty</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              <tr>
                <td className="py-3 px-4">
                  <div className="font-semibold text-slate-800">
                    {transaction.title}
                  </div>
                  {transaction.description && (
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      {transaction.description}
                    </div>
                  )}
                  {transaction.recipientName && (
                    <div className="text-indigo-600 text-[11px] font-medium mt-0.5">
                      Recipient: {transaction.recipientName}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 text-right text-slate-600">1</td>
                <td className="py-3 px-4 text-right font-semibold text-slate-800">
                  {transaction.currency}{transaction.amount.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Breakdown summary */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{transaction.currency}{transaction.amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Platform Fee (Student Free Tier)</span>
              <span className="text-emerald-600 font-medium">$0.00 (Waived)</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax (GST / VAT)</span>
              <span>$0.00</span>
            </div>
            <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-slate-200 text-sm">
              <span>Total Paid</span>
              <span>{transaction.currency}{transaction.amount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {transaction.status === 'completed' ? (
            <button
              onClick={() => {
                if (window.confirm('Simulate refund for this demo transaction?')) {
                  refundTransaction(transaction.id);
                  onClose();
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Simulate Sandbox Refund
            </button>
          ) : (
            <span className="text-xs text-slate-400">
              Non-refundable status: {transaction.status}
            </span>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Save Receipt
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
