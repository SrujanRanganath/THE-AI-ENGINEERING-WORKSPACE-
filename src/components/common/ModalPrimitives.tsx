import React, { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Save,
} from 'lucide-react';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  disableEscape?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg';
}

const MAX_WIDTH_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

/**
 * Accessible base modal dialog with focus trapping, initial focus management,
 * Escape key handling, and ARIA attributes.
 */
export const ModalDialog: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  disableEscape = false,
  maxWidth = 'md',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element inside the modal
    const timer = setTimeout(() => {
      if (!dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        dialogRef.current.focus();
      }
    }, 10);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableEscape) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === dialogRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, disableEscape, onClose]);

  if (!isOpen) return null;

  const titleId = `modal-title-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const descId = description ? `modal-desc-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disableEscape) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={`bg-[#0c101a] border border-white/10 rounded-xl p-5 w-full ${MAX_WIDTH_CLASSES[maxWidth]} space-y-4 shadow-2xl focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="text-sm font-semibold text-white">
              {title}
            </h3>
            {description && (
              <p id={descId} className="text-xs text-slate-400 mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {!disableEscape && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {children}
        {footer && (
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 1. Confirmation Modal
// ---------------------------------------------------------------------------
export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'emerald';
  isLoading?: boolean;
  children?: React.ReactNode;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  children,
}) => {
  const btnClasses = {
    danger: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20',
    primary: 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20',
    emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20',
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      disableEscape={isLoading}
      maxWidth="md"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            variant === 'danger'
              ? 'bg-rose-500/10 text-rose-400'
              : variant === 'emerald'
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-purple-500/10 text-purple-400'
          }`}
        >
          <AlertTriangle size={16} />
        </div>
        <div className="text-xs text-slate-300 leading-relaxed flex-1">
          <p>{message}</p>
          {children}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="px-3.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 ${btnClasses[variant]}`}
        >
          {isLoading && <Loader2 size={13} className="animate-spin" />}
          <span>{confirmLabel}</span>
        </button>
      </div>
    </ModalDialog>
  );
};

// ---------------------------------------------------------------------------
// 2. Error Modal
// ---------------------------------------------------------------------------
export interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  details?: string;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  title = 'Operation Error',
  message,
  details,
}) => {
  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0">
          <AlertCircle size={16} />
        </div>
        <div className="space-y-2 flex-1 min-w-0">
          <p className="text-xs text-rose-200 leading-relaxed">{message}</p>
          {details && (
            <pre className="p-2.5 rounded-lg bg-[#07090e] border border-rose-500/20 text-[11px] font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap">
              {details}
            </pre>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors"
        >
          Dismiss
        </button>
      </div>
    </ModalDialog>
  );
};

// ---------------------------------------------------------------------------
// 3. Success Modal
// ---------------------------------------------------------------------------
export interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  actionLabel?: string;
}

export const SuccessModal: React.FC<SuccessModalProps> = ({
  isOpen,
  onClose,
  title = 'Success',
  message,
  actionLabel = 'Continue',
}) => {
  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title={title} maxWidth="sm">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 size={16} />
        </div>
        <p className="text-xs text-slate-300 leading-relaxed pt-1">{message}</p>
      </div>

      <div className="flex justify-end pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    </ModalDialog>
  );
};

// ---------------------------------------------------------------------------
// 4. Loading Modal
// ---------------------------------------------------------------------------
export interface LoadingModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
}

export const LoadingModal: React.FC<LoadingModalProps> = ({
  isOpen,
  title = 'Processing Request',
  message = 'Please wait while the workspace completes this operation...',
}) => {
  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={() => {}}
      title={title}
      disableEscape={true}
      maxWidth="sm"
    >
      <div className="flex items-center gap-3 py-2">
        <Loader2 size={20} className="text-purple-400 animate-spin shrink-0" />
        <p className="text-xs text-slate-300 leading-relaxed">{message}</p>
      </div>
    </ModalDialog>
  );
};

// ---------------------------------------------------------------------------
// 5. Unsaved Changes Confirmation Modal
// ---------------------------------------------------------------------------
export interface UnsavedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onSaveAndContinue?: () => void;
  fileName?: string;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  onClose,
  onDiscard,
  onSaveAndContinue,
  fileName,
}) => {
  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Unsaved Source Modifications"
      maxWidth="md"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
          <AlertTriangle size={16} />
        </div>
        <div className="text-xs text-slate-300 leading-relaxed space-y-1">
          <p>
            You have unsaved changes in{' '}
            <span className="font-mono font-semibold text-white">
              {fileName || 'the active file'}
            </span>
            .
          </p>
          <p className="text-slate-400">
            Would you like to save your edits before switching files or discard them?
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-white/5">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white text-xs font-medium"
        >
          Keep Editing
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 text-xs font-medium"
        >
          Discard Changes
        </button>
        {onSaveAndContinue && (
          <button
            type="button"
            onClick={onSaveAndContinue}
            className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium flex items-center gap-1.5"
          >
            <Save size={13} />
            <span>Save & Continue</span>
          </button>
        )}
      </div>
    </ModalDialog>
  );
};
