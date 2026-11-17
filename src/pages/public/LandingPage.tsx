import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  Code2,
  Globe,
  FileText,
  Table2,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Lock,
  Cpu,
  Layers,
  Menu,
  X,
} from 'lucide-react';

const HERO_AGENT_PREVIEWS = [
  {
    id: 'code',
    number: '01',
    label: 'Code Generator',
    route: '/code-generator',
    meta: 'TypeScript · Express.js · Multi-File · Diff Review',
    title: 'Multi-File Code Repository & Diff Studio',
    snippet: `// src/routes/orders.ts — Immutable Snapshot v3
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';

export const orderRouter = Router();

orderRouter.post('/api/v1/orders', authGuard, async (req, res) => {
  const { sku, quantity } = req.body;
  return res.status(201).json({ orderId: 'ord_948201', sku, quantity });
});`,
    deliverables: [
      'Complete multi-file directory trees & safe archive paths',
      'Side-by-side modification previews & immutable version history',
      '1-click verified ZIP export',
    ],
  },
  {
    id: 'website',
    number: '02',
    label: 'Website Generator',
    route: '/website-generator',
    meta: 'React 19 · Vite · Tailwind CSS · esbuild-wasm',
    title: 'React/Vite Studio & Sandboxed Live Preview',
    snippet: `// src/App.tsx — Compiled in-browser inside opaque-origin sandbox
import React from 'react';
import { Hero } from './components/Hero';
import { Architecture } from './components/Architecture';

export default function App() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Hero headline="Telemetry Built for Scale" />
      <Architecture />
    </main>
  );
}`,
    deliverables: [
      'Validated multi-file React/Vite & HTML manifests',
      'Isolated sandboxed preview + persistent Publish URLs',
      'Interactive file explorer & deployable ZIP export',
    ],
  },
  {
    id: 'document',
    number: '03',
    label: 'Document Generator',
    route: '/document-generator',
    meta: 'Prompt-Driven · Structured Markdown · OpenXML .docx',
    title: 'Prompt-Driven Document Publishing Studio',
    snippet: `# System Architecture & Evaluation Report

## 1. Overview
Structured sections, tables, and numbered workflows planned
directly from title, document type, target page count, and prompt.

| Component | Isolation Boundary | Export |
| --- | --- | --- |
| Document Studio | Owner-scoped Firestore | OpenXML .docx |`,
    deliverables: [
      'Simple 4-field prompt-driven generation (title, type, pages, prompt)',
      'Live Markdown preview & inline editor',
      'Standards-compliant Microsoft Word (.docx) export',
    ],
  },
  {
    id: 'data',
    number: '04',
    label: 'Data Cleaner',
    route: '/data-cleaner',
    meta: 'CSV / XLSX · Natural-Language Agent · Non-Destructive',
    title: 'Natural-Language Statistical Data Cleaner',
    snippet: `Prompt: "Remove duplicates by email, trim whitespace, fill missing
         age with mean, and standardize signup_date to YYYY-MM-DD."
------------------------------------------------------------------
Plan validated against schema (0 unrequested operations added)
Original dataset preserved intact -> Clean CSV & XLSX ready`,
    deliverables: [
      'Plain-English instructions mapped to validated local transforms',
      'Clarification prompts on ambiguous or invalid column requests',
      'Original dataset preservation + CSV & Excel (.xlsx) export',
    ],
  },
];

const AGENTS = [
  {
    id: 'code-generator',
    number: '01',
    title: 'Code Generator',
    subtitle: 'Multi-File Software & Diff Studio',
    route: '/code-generator',
    description:
      'Generate modular multi-file software repositories across 9 programming languages with side-by-side modification diffs, immutable version history, and ZIP exports.',
    icon: Code2,
    accentBorder: 'hover:border-violet-500/40',
    accentText: 'text-violet-400',
    accentBg: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    highlights: [
      '9 languages with multi-file directory trees',
      'Modification diff preview & immutable snapshots',
      'Path-sanitized ZIP archive download',
    ],
  },
  {
    id: 'website-generator',
    number: '02',
    title: 'Website Generator',
    subtitle: 'React/Vite Compiler & Sandboxed Preview',
    route: '/website-generator',
    description:
      'Build complete React/Vite or HTML/CSS sites with an in-browser esbuild-wasm compiler, file explorer, diagnostics, persistent public previews, and ZIP export.',
    icon: Globe,
    accentBorder: 'hover:border-indigo-500/40',
    accentText: 'text-indigo-400',
    accentBg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    highlights: [
      'Validated multi-file React/Vite manifests',
      'Opaque-origin sandboxed live preview & publish URLs',
      'Complete source code ZIP bundle export',
    ],
  },
  {
    id: 'document-generator',
    number: '03',
    title: 'Document Generator',
    subtitle: 'Prompt-Driven Word & Markdown Publishing',
    route: '/document-generator',
    description:
      'Describe your title, document type, target page count, and instructions in plain English. Edit generated Markdown live and compile genuine Microsoft Word (.docx) files.',
    icon: FileText,
    accentBorder: 'hover:border-sky-500/40',
    accentText: 'text-sky-400',
    accentBg: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    highlights: [
      'AI-planned sections, headings, tables & lists',
      'Live Markdown editor with persistent storage',
      'Native OpenXML Microsoft Word (.docx) export',
    ],
  },
  {
    id: 'data-cleaner',
    number: '04',
    title: 'Data Cleaner',
    subtitle: 'Natural-Language Statistical Pipeline',
    route: '/data-cleaner',
    description:
      'Upload CSV or XLSX files, inspect column types and missing values, describe cleaning tasks in plain English, compare Before vs. After output, and export clean sheets.',
    icon: Table2,
    accentBorder: 'hover:border-emerald-500/40',
    accentText: 'text-emerald-400',
    accentBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    highlights: [
      'Schema-validated natural-language cleaning agent',
      'Strict original dataset preservation & diff summary',
      'Verified CSV & Excel (.xlsx) exports',
    ],
  },
];

export const LandingPage: React.FC = () => {
  const { currentUser, loginAsGuest } = useAuth();
  const navigate = useNavigate();

  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLaunchAgent = (targetRoute = '/dashboard') => {
    if (!currentUser) {
      loginAsGuest();
    }
    navigate(targetRoute);
  };

  const activePreview = HERO_AGENT_PREVIEWS[activePreviewIdx];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      {/* 1. Unified 3-Zone Top Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-violet-600/25 ring-1 ring-white/15">
              <Layers size={17} />
            </span>
            <span>AI Engineering Workspace</span>
          </Link>

          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400"
          >
            <a href="#agents" className="hover:text-white transition-colors whitespace-nowrap">
              Four Agents
            </a>
            <a
              href="#architecture"
              className="hover:text-white transition-colors whitespace-nowrap"
            >
              Architecture
            </a>
            <Link to="/features" className="hover:text-white transition-colors whitespace-nowrap">
              Features
            </Link>
          </nav>

          <div className="hidden md:flex items-center gap-3 shrink-0">
            {currentUser ? (
              <Link
                to="/dashboard"
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm shadow-violet-600/25"
              >
                <span>Open Workspace</span>
                <ArrowRight size={14} />
              </Link>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 shadow-sm shadow-violet-600/25"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800/70"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-zinc-800/80 bg-[#111116] px-4 py-4 space-y-3">
            <div className="flex flex-col space-y-2 text-sm font-medium text-zinc-300">
              <a
                href="#agents"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-white"
              >
                Four Agents
              </a>
              <a
                href="#architecture"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-white"
              >
                Architecture
              </a>
              <Link
                to="/features"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-white"
              >
                Features
              </Link>
            </div>
            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              {currentUser ? (
                <Link
                  to="/dashboard"
                  className="w-full py-2.5 px-4 rounded-lg bg-violet-600 text-white text-xs font-semibold text-center"
                >
                  Open Workspace
                </Link>
              ) : (
                <>
                  <Link
                    to="/signin"
                    className="flex-1 py-2.5 px-4 rounded-lg border border-zinc-700 text-zinc-200 text-xs font-medium text-center"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    className="flex-1 py-2.5 px-4 rounded-lg bg-violet-600 text-white text-xs font-semibold text-center"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* 2. Concise Split Hero Section */}
      <section className="relative pt-14 pb-16 lg:pt-20 lg:pb-20 border-b border-zinc-800/80 bg-architectural-grid overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
              <div className="space-y-5">
                <p className="text-xs font-mono uppercase tracking-wider text-violet-400">
                  One Workspace · Four Intelligent Agents · Infinite Possibilities
                </p>

                <h1
                  className="font-bold tracking-tight text-white leading-[1.1]"
                  style={{ fontSize: 'clamp(2.1rem, 3.8vw, 3.35rem)', textWrap: 'balance' }}
                >
                  Code, Websites, Documents, and Clean Data in One Studio.
                </h1>

                <p className="text-sm sm:text-base text-zinc-400 max-w-xl leading-relaxed">
                  AI Engineering Workspace unifies four specialized AI agents with owner-scoped
                  cloud persistence, isolated React/Vite previews, OpenXML Word generation, and
                  natural-language data cleaning.
                </p>
              </div>

              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3.5">
                  <Link
                    to={currentUser ? '/dashboard' : '/signup'}
                    className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-all shadow-lg shadow-violet-600/20 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <span>{currentUser ? 'Open Workspace' : 'Get Started'}</span>
                    <ArrowRight size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleLaunchAgent('/dashboard')}
                    className="px-5 py-3 rounded-xl bg-[#111116] hover:bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Try Guest Workspace
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 font-mono">
                  <span>Firebase Auth & Firestore</span>
                  <span aria-hidden="true">·</span>
                  <span>Server-Side Gemini Proxy</span>
                  <span aria-hidden="true">·</span>
                  <span>ZIP, DOCX, CSV & XLSX Exports</span>
                </div>
              </div>
            </div>

            {/* Interactive 4-Agent Console Preview */}
            <div className="lg:col-span-6 flex flex-col">
              <div className="flex-1 rounded-2xl bg-[#111116] border border-zinc-800/90 shadow-2xl overflow-hidden flex flex-col justify-between">
                <div className="p-2 bg-[#0d0d12] border-b border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-1">
                  {HERO_AGENT_PREVIEWS.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActivePreviewIdx(idx)}
                      className={`px-2.5 py-2 rounded-lg text-xs font-medium transition-colors text-left truncate cursor-pointer ${
                        activePreviewIdx === idx
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <span className="font-mono text-[10px] opacity-75 mr-1">{item.number}.</span>
                      <span>{item.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>

                <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">
                        {activePreview.title}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400">{activePreview.meta}</p>

                    <pre className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/90 text-[11px] font-mono text-zinc-200 overflow-x-auto leading-relaxed max-h-44">
                      <code>{activePreview.snippet}</code>
                    </pre>

                    <ul className="space-y-1.5 pt-1">
                      {activePreview.deliverables.map((d) => (
                        <li key={d} className="flex items-center gap-2 text-xs text-zinc-300">
                          <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">
                      Sample workflows included
                    </span>
                    <button
                      type="button"
                      onClick={() => handleLaunchAgent(activePreview.route)}
                      className="text-xs font-semibold text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>Open {activePreview.label}</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Four Independent Intelligent Agents Section */}
      <section id="agents" className="py-16 border-b border-zinc-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-violet-400">
                Four Independent AI Agents
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mt-1 tracking-tight">
                Purpose-Built Engineering Studios
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-md">
              Launch any agent inside one unified platform with persistent project history and
              native artifact exports.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {AGENTS.map((agent) => {
              const Icon = agent.icon;
              return (
                <div
                  key={agent.id}
                  className={`rounded-2xl bg-[#111116] border border-zinc-800/80 ${agent.accentBorder} p-6 transition-colors flex flex-col justify-between space-y-5`}
                >
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <div
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center ${agent.accentBg}`}
                      >
                        <Icon size={19} />
                      </div>
                      <span className="text-xs font-mono text-zinc-500">Agent {agent.number}</span>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {agent.number}. {agent.title}
                      </h3>
                      <p className={`text-xs font-medium mt-0.5 ${agent.accentText}`}>
                        {agent.subtitle}
                      </p>
                    </div>

                    <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                      {agent.description}
                    </p>

                    <ul className="space-y-1.5 pt-1">
                      {agent.highlights.map((feat) => (
                        <li key={feat} className="flex items-center gap-2 text-xs text-zinc-300">
                          <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => handleLaunchAgent(agent.route)}
                      className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-violet-600 border border-zinc-800 hover:border-violet-500 text-zinc-100 hover:text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Open {agent.title}</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. Concise Architecture & Security Guarantees */}
      <section id="architecture" className="py-16 bg-[#0d0d12]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="max-w-2xl space-y-1.5">
            <p className="text-xs font-mono uppercase tracking-wider text-violet-400">
              Platform Architecture
            </p>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Security, Persistence, and Verified Exports
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <Lock size={15} />
                <span>Owner-Scoped Firestore Storage</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Every code repository, website manifest, document, and dataset enforces strict{' '}
                <code className="text-emerald-300">ownerId == request.auth.uid</code> rules with
                field-level allowlists.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2">
              <div className="flex items-center gap-2 text-violet-400 text-xs font-semibold">
                <ShieldCheck size={15} />
                <span>Server-Side AI & Salted Email OTP</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Gemini requests run strictly through Express backend endpoints so API keys never
                ship to browsers, paired with salted HMAC-SHA256 6-digit signup verification.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-2">
              <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
                <Cpu size={15} />
                <span>Sandboxed Previews & Native Exports</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Generated websites run inside opaque-origin{' '}
                <code className="text-indigo-300">sandbox="allow-scripts"</code> iframes, and
                artifacts export natively as <code className="text-zinc-200">.zip</code>,{' '}
                <code className="text-zinc-200">.docx</code>,{' '}
                <code className="text-zinc-200">.csv</code>, and{' '}
                <code className="text-zinc-200">.xlsx</code>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Minimal Footer */}
      <footer className="border-t border-zinc-800/80 bg-[#09090b] py-10 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white">
              <Layers size={14} />
            </span>
            <div>
              <div>AI Engineering Workspace</div>
              <p className="text-[11px] font-normal text-zinc-500">
                One Workspace. Four Intelligent Agents. Infinite Possibilities.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-400">
            <Link to="/features" className="hover:text-white transition-colors">
              Features
            </Link>
            <Link to="/signin" className="hover:text-white transition-colors">
              Sign In
            </Link>
            <Link to="/signup" className="hover:text-white transition-colors">
              Get Started
            </Link>
            <span className="text-zinc-600">
              © {new Date().getFullYear()} AI Engineering Workspace
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
