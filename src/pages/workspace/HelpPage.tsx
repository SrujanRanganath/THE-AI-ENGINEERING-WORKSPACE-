import React from 'react';
import { PREVIEW_COMPILER_CAPABILITIES } from '../../utils/reactPreviewCompiler';
import { useGuidedTour } from '../../lib/guidedTour';
import {
  HelpCircle,
  Code2,
  Globe,
  FileText,
  Table2,
  ShieldCheck,
  Download,
  Lock,
  Compass,
} from 'lucide-react';

export const HelpPage: React.FC = () => {
  const { startTour } = useGuidedTour();

  return (
    <div data-tour="help-documentation" className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-violet-400 mb-1">
            <HelpCircle size={15} />
            <span>Documentation & Reference</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            AI Engineering Workspace Guide
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Complete workflow reference for all four intelligent engineering agents, preview sandbox
            capabilities, authentication security, and exports.
          </p>
        </div>

        <button
          type="button"
          onClick={() => startTour(0)}
          data-testid="help-launch-tour-button"
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm shadow-violet-600/20 shrink-0 self-start sm:self-auto cursor-pointer"
        >
          <Compass size={14} />
          <span>Launch Interactive Guided Tour</span>
        </button>
      </div>

      {/* Agent Guides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2.5">
          <div className="flex items-center gap-2 text-violet-400 text-xs font-semibold">
            <Code2 size={16} />
            <span>01. Code Generator Workflow</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Specify your project name, programming language, framework, and database. After
            generation (or loading the built-in multi-file sample), inspect and edit files in the
            explorer, save immutable version snapshots, preview side-by-side diffs before applying
            modifications, and download the complete repository as a safe{' '}
            <code className="text-violet-300 font-mono">.zip</code> archive.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2.5">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
            <Globe size={16} />
            <span>02. Website Generator Workflow</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Select a website category, technology (React/Vite or HTML/CSS/JS), and design direction.
            The in-browser preview compiler resolves local imports, validates JSX/syntax, and
            renders inside an opaque-origin{' '}
            <code className="text-indigo-300 font-mono">sandbox="allow-scripts"</code> iframe with
            persistent one-click Publish Preview URLs.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2.5">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
            <FileText size={16} />
            <span>03. Document Generator Workflow</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Pick one of the 4 quick-start engineering templates or choose from 9 document categories
            and 5 tones. Edit the generated markdown directly in the browser and click "Export DOCX"
            to compile a native Microsoft Word (
            <code className="text-sky-300 font-mono">.docx</code>) file that incorporates your live
            edits.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
            <Table2 size={16} />
            <span>04. Data Cleaner Workflow</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Upload a <code className="text-emerald-300 font-mono">.csv</code> or{' '}
            <code className="text-emerald-300 font-mono">.xlsx</code> dataset (or load the built-in
            dirty sample). Queue any of the 10 deterministic cleaning operations, review the Before
            vs. After comparison summary, and export clean CSV or Excel files while preserving the
            original dataset intact.
          </p>
        </div>
      </div>

      {/* Preview Compiler Capabilities & Limitations */}
      <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-violet-400">
          <Globe size={15} />
          <span>React/Vite Preview Compiler Capabilities & Boundaries</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5">
            <h4 className="font-semibold text-white">Supported Syntax & Hooks</h4>
            <ul className="space-y-1 text-zinc-400 list-disc pl-4">
              {PREVIEW_COMPILER_CAPABILITIES.supportedSyntax.map((s) => (
                <li key={s}>{s}</li>
              ))}
              <li>
                Supported React Hooks: {PREVIEW_COMPILER_CAPABILITIES.supportedHooks.join(', ')}
              </li>
              <li>
                Built-in Offline Package Shims:{' '}
                {PREVIEW_COMPILER_CAPABILITIES.supportedPackages.join(', ')}
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <h4 className="font-semibold text-white">Security Boundaries & Limitations</h4>
            <ul className="space-y-1 text-zinc-400 list-disc pl-4">
              {PREVIEW_COMPILER_CAPABILITIES.securityBoundaries.map((b) => (
                <li key={b}>{b}</li>
              ))}
              {PREVIEW_COMPILER_CAPABILITIES.knownLimitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Security & Authentication Reference */}
      <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
          <ShieldCheck size={16} />
          <span>Authentication, 6-Digit Email OTP & Data Privacy</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-zinc-300">
          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80">
            <div className="font-semibold text-white mb-1 flex items-center gap-1.5">
              <Lock size={13} className="text-violet-400" />
              <span>6-Digit Email OTP</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              New email registrations verify ownership using a server-side salted HMAC-SHA256
              6-digit OTP and signed verification token with 10-minute expiration, 60-second resend cooldown, and 5-attempt
              brute-force protection.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80">
            <div className="font-semibold text-white mb-1">Strict Owner Scoping</div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              All database records are keyed by your authenticated UID. Guest projects are
              idempotently migrated to your account upon verification.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80">
            <div className="font-semibold text-white mb-1 flex items-center gap-1.5">
              <Download size={13} className="text-emerald-400" />
              <span>Sanitized Exports</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              ZIP exports strip relative traversal paths (<code className="text-zinc-300 font-mono">../</code>)
              before packaging files into local archives.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
