import React, { useEffect } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
  type?: 'success' | 'warning' | 'info';
}

export const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose, type }) => {
  // Infer type based on message keywords if not explicitly provided
  const inferredType = type || (
    message.toLowerCase().includes('copied') || message.toLowerCase().includes('success') ? 'success' :
    message.toLowerCase().includes('truncat') || message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? 'warning' : 
    'info'
  );

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-8 left-0 w-full flex justify-center z-[100] pointer-events-none">
      <div className="animate-scale-in pointer-events-auto">
        <div className="flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-full shadow-2xl border backdrop-blur-xl 
          bg-white/70 dark:bg-neutral-900/70 border-neutral-200/50 dark:border-neutral-800/50 
          text-neutral-700 dark:text-neutral-200 max-w-md"
        >
          {inferredType === 'success' && (
            <div className="bg-teal-500 rounded-full p-1 text-white shadow-sm flex-shrink-0">
                <Check size={14} strokeWidth={3} />
            </div>
          )}
          {inferredType === 'warning' && (
            <div className="bg-amber-500 rounded-full p-1 text-white shadow-sm flex-shrink-0">
                <AlertTriangle size={14} strokeWidth={2.5} />
            </div>
          )}
          {inferredType === 'info' && (
            <div className="bg-blue-500 rounded-full p-1 text-white shadow-sm flex-shrink-0">
                <Info size={14} strokeWidth={2.5} />
            </div>
          )}

          <span className="text-sm font-medium leading-none pt-0.5">{message}</span>
          
          <button 
            onClick={onClose} 
            className="ml-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors flex-shrink-0"
          >
              <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};