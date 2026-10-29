import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => {
        const getIcon = () => {
          switch (toast.type) {
            case 'success':
              return <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />;
            case 'error':
              return <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />;
            case 'warning':
              return <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />;
            default:
              return <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />;
          }
        };

        const getBorderColor = () => {
          switch (toast.type) {
            case 'success':
              return 'border-emerald-200 bg-white';
            case 'error':
              return 'border-rose-200 bg-white';
            case 'warning':
              return 'border-amber-200 bg-white';
            default:
              return 'border-indigo-200 bg-white';
          }
        };

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl border shadow-lg transition-all duration-200 ${getBorderColor()} flex items-start gap-3`}
            role="alert"
          >
            {getIcon()}
            <div className="flex-1 min-w-0">
              {toast.title && (
                <p className="text-sm font-semibold text-slate-900 leading-snug">{toast.title}</p>
              )}
              <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
