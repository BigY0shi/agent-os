'use client';

import { X } from 'lucide-react';

export default function Modal({
  isOpen,
  onClose,
  onSubmit,
  title,
  children,
  size = 'md',
  submitLabel = 'Save',
}) {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className={`relative w-full mx-4 ${sizeClasses[size]}`}>
        <div className="bg-surface-900 border border-surface-600/50 rounded-lg shadow-2xl">
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/50">
              <h2 className="text-lg font-semibold text-surface-100">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="p-1 text-surface-400 hover:text-surface-200 hover:bg-surface-800/50 rounded-md transition-all"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
          )}

          {/* Body */}
          <div className="px-6 py-4 max-h-[60vh] overflow-y-scroll overscroll-contain" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
            {children}
          </div>

          {/* Footer */}
          {onSubmit && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-700/50">
              <button
                onClick={onClose}
                className="btn-default"
              >
                Cancel
              </button>
              <button
                onClick={onSubmit}
                className="btn-accent"
              >
                {submitLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
