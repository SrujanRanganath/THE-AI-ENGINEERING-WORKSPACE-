import React, { useEffect, useState } from 'react';
import { useGuidedTour } from '../../lib/guidedTour';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  Compass,
  Code2,
  Globe,
  FileText,
  Table2,
} from 'lucide-react';

interface HighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const GuidedTourOverlay: React.FC = () => {
  const {
    isWelcomeOpen,
    isTourActive,
    currentStepIndex,
    currentStep,
    totalSteps,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    finishTour,
  } = useGuidedTour();

  const [highlightBox, setHighlightBox] = useState<HighlightBox | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const [popoverHeight, setPopoverHeight] = useState<number>(310);
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  });

  // Track actual popover height so clamping never clips bottom controls
  useEffect(() => {
    if (!isTourActive || !popoverRef.current) return;
    const measured = popoverRef.current.offsetHeight;
    if (measured > 0 && Math.abs(measured - popoverHeight) > 2) {
      setPopoverHeight(measured);
    }
  }, [isTourActive, currentStepIndex, viewport.width, viewport.height, popoverHeight]);

  // Track viewport size
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keyboard Escape handler
  useEffect(() => {
    if (!isTourActive && !isWelcomeOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void skipTour();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTourActive, isWelcomeOpen, skipTour]);

  // Measure target element across route changes and Suspense mounts
  useEffect(() => {
    if (!isTourActive) {
      setHighlightBox(null);
      return;
    }

    let rafId = 0;
    let pollCount = 0;
    let disposed = false;

    const measureTarget = () => {
      if (disposed) return;
      const el = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (rect.top < 72 || rect.bottom > window.innerHeight - 160) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          const updated = el.getBoundingClientRect();
          setHighlightBox({
            top: Math.max(8, updated.top - 6),
            left: Math.max(8, updated.left - 6),
            width: Math.min(window.innerWidth - 16, updated.width + 12),
            height: Math.min(window.innerHeight - 16, updated.height + 12),
          });
          return;
        }
      }

      if (pollCount < 25) {
        pollCount += 1;
        rafId = window.setTimeout(measureTarget, 80);
      } else {
        setHighlightBox(null);
      }
    };

    const initialTimer = window.setTimeout(measureTarget, 60);
    window.addEventListener('scroll', measureTarget, true);
    window.addEventListener('resize', measureTarget);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearTimeout(rafId);
      window.removeEventListener('scroll', measureTarget, true);
      window.removeEventListener('resize', measureTarget);
    };
  }, [isTourActive, currentStepIndex, currentStep.targetSelector]);

  // 1. First-Time Welcome Modal
  if (isWelcomeOpen) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-welcome-title"
        data-testid="guided-tour-welcome-modal"
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      >
        <div className="w-full max-w-lg rounded-2xl bg-[#111116] border border-zinc-800 shadow-2xl overflow-hidden">
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-400 flex items-center justify-center shrink-0">
                  <Compass size={20} />
                </div>
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-wider text-violet-400">
                    Workspace Onboarding
                  </span>
                  <h2
                    id="guided-tour-welcome-title"
                    className="text-lg font-semibold text-white tracking-tight"
                  >
                    Welcome to AI Engineering Workspace
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void skipTour()}
                aria-label="Close welcome dialog"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Take a quick 9-step interactive tour across your command center, the four specialized
              AI engineering agents, and your persistent project tools.
            </p>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 rounded-xl bg-[#09090b] border border-zinc-800/80 flex items-center gap-2.5">
                <Code2 size={15} className="text-violet-400 shrink-0" />
                <span className="text-zinc-200 font-medium truncate">Code Generator</span>
              </div>
              <div className="p-3 rounded-xl bg-[#09090b] border border-zinc-800/80 flex items-center gap-2.5">
                <Globe size={15} className="text-indigo-400 shrink-0" />
                <span className="text-zinc-200 font-medium truncate">Website Builder</span>
              </div>
              <div className="p-3 rounded-xl bg-[#09090b] border border-zinc-800/80 flex items-center gap-2.5">
                <Table2 size={15} className="text-emerald-400 shrink-0" />
                <span className="text-zinc-200 font-medium truncate">Data Cleaner</span>
              </div>
              <div className="p-3 rounded-xl bg-[#09090b] border border-zinc-800/80 flex items-center gap-2.5">
                <FileText size={15} className="text-sky-400 shrink-0" />
                <span className="text-zinc-200 font-medium truncate">Document Generator</span>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-[#0b0b0f] border-t border-zinc-800/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void skipTour()}
              data-testid="tour-welcome-skip"
              className="px-4 py-2 rounded-lg border border-zinc-800 hover:bg-zinc-800/80 text-zinc-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
            >
              Skip Tour
            </button>
            <button
              type="button"
              onClick={() => startTour(0)}
              data-testid="tour-welcome-start"
              className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm shadow-violet-600/25 cursor-pointer"
            >
              <Sparkles size={14} />
              <span>Start Tour (9 Steps)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Active 9-Step Interactive Spotlight & Popover
  if (!isTourActive) return null;

  const isLastStep = currentStepIndex === totalSteps - 1;
  const progressPct = Math.round(((currentStepIndex + 1) / totalSteps) * 100);
  const isMobile = viewport.width < 640;

  // Compute non-clipping popover coordinates using measured height
  const popoverStyle: React.CSSProperties = (() => {
    if (isMobile || !highlightBox) {
      return {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(420px, calc(100vw - 24px))',
      };
    }
    const cardWidth = 400;
    const safeHeight = Math.max(280, popoverHeight);
    const maxTop = Math.max(16, viewport.height - safeHeight - 16);
    const spaceBelow = viewport.height - (highlightBox.top + highlightBox.height);
    const placeBelow = spaceBelow >= safeHeight + 24 || highlightBox.top < safeHeight + 24;

    const rawTop = placeBelow
      ? highlightBox.top + highlightBox.height + 14
      : highlightBox.top - safeHeight - 14;
    const top = Math.max(16, Math.min(maxTop, rawTop));

    const left = Math.max(
      16,
      Math.min(viewport.width - cardWidth - 16, highlightBox.left)
    );

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${cardWidth}px`,
    };
  })();

  return (
    <div
      data-testid="guided-tour-overlay"
      className="fixed inset-0 z-[70] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-tour-step-title"
    >
      {/* Dimmed Backdrop / Spotlight Cutout */}
      {highlightBox ? (
        <div
          aria-hidden="true"
          className="fixed rounded-xl border-2 border-violet-500 transition-all duration-300 pointer-events-none"
          style={{
            top: `${highlightBox.top}px`,
            left: `${highlightBox.left}px`,
            width: `${highlightBox.width}px`,
            height: `${highlightBox.height}px`,
            boxShadow: '0 0 0 9999px rgba(4, 4, 7, 0.72), 0 0 24px rgba(124, 58, 237, 0.25)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-black/70 pointer-events-none" />
      )}

      {/* Interactive Popover Card */}
      <div
        ref={popoverRef}
        style={popoverStyle}
        data-testid="guided-tour-popover"
        className="pointer-events-auto rounded-2xl bg-[#111116] border border-zinc-700/80 shadow-2xl overflow-y-auto max-h-[calc(100vh-32px)]"
      >
        {/* Top Progress Strip */}
        <div className="h-1 w-full bg-zinc-800">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="p-5 space-y-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  data-testid="guided-tour-progress"
                  className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-mono font-semibold tabular-nums"
                >
                  Step {currentStep.stepNumber} of {totalSteps}
                </span>
                <span className="text-[11px] font-mono text-zinc-500">{currentStep.route}</span>
              </div>
              <h3
                id="guided-tour-step-title"
                className="text-sm sm:text-base font-semibold text-white tracking-tight"
              >
                {currentStep.title}
              </h3>
            </div>

            <button
              type="button"
              onClick={() => void skipTour()}
              aria-label="Skip guided tour"
              data-testid="tour-close-button"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            >
              <X size={15} />
            </button>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">{currentStep.description}</p>

          {currentStep.highlights.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {currentStep.highlights.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[11px] text-zinc-400">
                  <CheckCircle2 size={13} className="text-violet-400 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Navigation Controls */}
        <div className="px-5 py-3.5 bg-[#0b0b0f] border-t border-zinc-800/80 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void skipTour()}
            data-testid="tour-skip-button"
            className="text-xs text-zinc-400 hover:text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            Skip
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prevStep}
              disabled={currentStepIndex === 0}
              data-testid="tour-prev-button"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <ChevronLeft size={13} />
              <span>Previous</span>
            </button>

            {isLastStep ? (
              <button
                type="button"
                onClick={() => void finishTour()}
                data-testid="tour-finish-button"
                className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm shadow-violet-600/25 cursor-pointer"
              >
                <CheckCircle2 size={13} />
                <span>Finish</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={nextStep}
                data-testid="tour-next-button"
                className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors shadow-sm shadow-violet-600/25 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
