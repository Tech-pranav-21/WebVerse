import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Student } from '../../types';
import { useApp } from '../../context/AppContext';
import { Avatar } from '../common/Avatar';
import { Heart, Coffee, Sparkles, Send, Gift } from 'lucide-react';

interface TipStudentModalProps {
  student: Student | null;
  isOpen: boolean;
  onClose: () => void;
}

export const TipStudentModal: React.FC<TipStudentModalProps> = ({
  student,
  isOpen,
  onClose
}) => {
  const { sendTip } = useApp();
  const [selectedAmount, setSelectedAmount] = useState<number>(5);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isCustom, setIsCustom] = useState(false);
  const [note, setNote] = useState('');

  if (!student) return null;

  const tipPresets = [
    { amount: 3, label: '☕ Coffee ($3)', icon: Coffee },
    { amount: 5, label: '🍕 Snack ($5)', icon: Gift },
    { amount: 10, label: '🍱 Lunch ($10)', icon: Sparkles },
    { amount: 20, label: '🌟 Star Mentor ($20)', icon: Heart },
  ];

  const handleSelectPreset = (amount: number) => {
    setSelectedAmount(amount);
    setIsCustom(false);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, '');
    setCustomAmount(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      setSelectedAmount(parsed);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = isCustom ? parseFloat(customAmount) : selectedAmount;
    if (!finalAmount || finalAmount <= 0) return;

    onClose();
    sendTip(student, finalAmount, note.trim() || undefined);
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={`Appreciation Tip for ${student.name}`}
      description="Recognize exceptional peer teaching & help support fellow students"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-200 shadow-xs">
            <Heart className="w-6 h-6 fill-rose-500 text-rose-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
              Appreciation Tip for {student.name}
            </h3>
            <p className="text-xs text-slate-500">
              Recognize exceptional peer teaching & help support fellow students.
            </p>
          </div>
        </div>

        {/* Student card snippet */}
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
          <Avatar name={student.name} initials={student.initials} size="sm" />
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">
              {student.name}
            </div>
            <div className="text-[10px] text-slate-500 truncate">
              {student.department} · {student.college}
            </div>
          </div>
        </div>

        {/* Tip presets */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700">
            Choose Tip Amount
          </label>
          <div className="grid grid-cols-2 gap-2">
            {tipPresets.map((preset) => {
              const isSelected = !isCustom && selectedAmount === preset.amount;
              return (
                <button
                  key={preset.amount}
                  type="button"
                  onClick={() => handleSelectPreset(preset.amount)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-rose-500 bg-rose-50 text-rose-700 font-bold ring-1 ring-rose-400'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700 text-xs font-semibold'
                  }`}
                >
                  <span className="block">{preset.label}</span>
                </button>
              );
            })}
          </div>

          {/* Custom amount toggle */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsCustom(true)}
              className={`text-xs font-semibold ${isCustom ? 'text-rose-600' : 'text-slate-500 hover:text-slate-800'}`}
            >
              + Enter custom amount
            </button>

            {isCustom && (
              <div className="mt-2 relative">
                <span className="absolute left-3.5 top-2.5 text-xs font-bold text-slate-400">$</span>
                <input
                  type="text"
                  value={customAmount}
                  onChange={handleCustomChange}
                  placeholder="e.g. 15.00"
                  className="w-full pl-8 pr-4 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 bg-white"
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>

        {/* Optional appreciation note */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            Add a Thank-You Note (Optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Thanks for the great tips on debugging and mock interviews!"
            className="w-full p-3 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-6 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Proceed to Demo Pay (${isCustom ? (parseFloat(customAmount) || 0).toFixed(2) : selectedAmount.toFixed(2)})</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
