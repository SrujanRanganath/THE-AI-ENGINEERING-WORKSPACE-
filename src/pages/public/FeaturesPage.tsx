import React from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../../components/layout/Navbar';
import {
  Code2,
  Globe,
  FileText,
  Table2,
  ArrowRight,
} from 'lucide-react';

export const FeaturesPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      <Navbar />

      <main className="flex-1 py-14 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <p className="text-xs font-mono uppercase tracking-wider text-violet-400 mb-2">
            Four Intelligent Agents
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Workspace Platform Features
          </h1>
          <p className="mt-3 text-zinc-400 text-sm sm:text-base leading-relaxed">
            Architecture and capabilities across all four agents inside AI Engineering Workspace.
          </p>
        </div>

        {/* Agent 1 */}
        <div className="p-7 rounded-2xl bg-[#111116] border border-zinc-800/80">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <Code2 size={22} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-violet-400 tracking-wider">
                Agent 01
              </span>
              <h2 className="text-xl font-bold text-white">Code Generator & Modifier</h2>
            </div>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed max-w-4xl mb-5">
            Synthesizes multi-file software repositories with configs, routers, models, tests, and
            documentation across 9 programming languages.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">9 Language Engines</h3>
              <p className="text-xs text-zinc-400">
                Python, JavaScript, TypeScript, Java, C, C++, C#, PHP, and Go with framework support.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Modification Diff Review</h3>
              <p className="text-xs text-zinc-400">
                Side-by-side file comparison before applying AI-assisted modifications.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Version Snapshots & ZIP</h3>
              <p className="text-xs text-zinc-400">
                Immutable snapshots with rollback and path-sanitized ZIP archive downloads.
              </p>
            </div>
          </div>
        </div>

        {/* Agent 2 */}
        <div className="p-7 rounded-2xl bg-[#111116] border border-zinc-800/80">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Globe size={22} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-indigo-400 tracking-wider">
                Agent 02
              </span>
              <h2 className="text-xl font-bold text-white">Website Generator</h2>
            </div>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed max-w-4xl mb-5">
            Generates React/Vite and HTML/CSS/JS web applications with validated manifests, live
            editing, persistent published links, and ZIP bundles.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Validated Manifests</h3>
              <p className="text-xs text-zinc-400">
                Multi-file React/Vite source structures with verified dependencies and imports.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Sandboxed Live Preview</h3>
              <p className="text-xs text-zinc-400">
                Opaque-origin iframe sandbox prevents untrusted execution on the app server.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Publish & ZIP Export</h3>
              <p className="text-xs text-zinc-400">
                Firestore-persisted shareable previews and runnable source code ZIP packages.
              </p>
            </div>
          </div>
        </div>

        {/* Agent 3 */}
        <div className="p-7 rounded-2xl bg-[#111116] border border-zinc-800/80">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <FileText size={22} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-sky-400 tracking-wider">
                Agent 03
              </span>
              <h2 className="text-xl font-bold text-white">Prompt-Driven Document Generator</h2>
            </div>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed max-w-4xl mb-5">
            Authors structured reports, research papers, proposals, and architecture documentation
            directly from title, document type, target page count, and prompt instructions.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Intelligent Structuring</h3>
              <p className="text-xs text-zinc-400">
                Automatically organizes headings, prose, numbered workflows, and Markdown tables.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Live Markdown Editor</h3>
              <p className="text-xs text-zinc-400">
                Inspect, refine, rename, and persist document revisions in Firestore.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Native Word (.docx)</h3>
              <p className="text-xs text-zinc-400">
                Compiles real OpenXML .docx binaries with headings, tables, and lists.
              </p>
            </div>
          </div>
        </div>

        {/* Agent 4 */}
        <div className="p-7 rounded-2xl bg-[#111116] border border-zinc-800/80">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Table2 size={22} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-emerald-400 tracking-wider">
                Agent 04
              </span>
              <h2 className="text-xl font-bold text-white">Natural-Language Data Cleaner</h2>
            </div>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed max-w-4xl mb-5">
            Processes CSV and Excel (.xlsx) datasets using statistical profiling and schema-validated
            natural-language instructions without altering original source data.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Plain-English Directives</h3>
              <p className="text-xs text-zinc-400">
                Executes only requested transformations and asks clarification on ambiguous prompts.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Statistical Profiling</h3>
              <p className="text-xs text-zinc-400">
                Real-time duplicate detection, missing-cell counts, and column type inference.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80">
              <h3 className="text-xs font-semibold text-white mb-1.5">Before vs. After Exports</h3>
              <p className="text-xs text-zinc-400">
                Original dataset remains preserved intact; exports verified CSV and XLSX files.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center pt-4">
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-all shadow-md shadow-violet-600/20"
          >
            <span>Get Started in Workspace</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </main>
    </div>
  );
};
