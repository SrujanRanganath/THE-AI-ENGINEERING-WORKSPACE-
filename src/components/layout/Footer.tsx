import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../common/Logo';
import { Github, Shield, Terminal, Database, Cpu } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-white/[0.08] bg-[#05070a] text-slate-400 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          <div className="md:col-span-2 space-y-4">
            <Logo showTagline={true} />
            <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
              One unified workspace powered by four intelligent engineering agents: Code Generator,
              Website Generator, Document Generator, and Data Cleaner.
            </p>
            <div className="flex items-center gap-3 text-xs text-slate-500 pt-1">
              <span>Firebase Auth & Firestore</span>
              <span>·</span>
              <span>Gemini Server Integration</span>
              <span>·</span>
              <span>Zero Cost Tier</span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">
              Four Agents
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/code-generator" className="hover:text-white transition-colors">
                  Code Generator
                </Link>
              </li>
              <li>
                <Link to="/website-generator" className="hover:text-white transition-colors">
                  Website Generator
                </Link>
              </li>
              <li>
                <Link to="/document-generator" className="hover:text-white transition-colors">
                  Document Generator
                </Link>
              </li>
              <li>
                <Link to="/data-cleaner" className="hover:text-white transition-colors">
                  Data Cleaner
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">
              Platform
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/features" className="hover:text-white transition-colors">
                  Features Overview
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="hover:text-white transition-colors">
                  Workspace Dashboard
                </Link>
              </li>
              <li>
                <Link to="/projects" className="hover:text-white transition-colors">
                  My Projects
                </Link>
              </li>
              <li>
                <Link to="/activity" className="hover:text-white transition-colors">
                  Activity Audit
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">
              Security & Trust
            </h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-1.5 text-slate-400">
                <Shield size={14} className="text-emerald-400" />
                ABAC Firestore Rules
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <Database size={14} className="text-blue-400" />
                Owner-Scoped Records
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <Cpu size={14} className="text-purple-400" />
                Protected Server Keys
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <Terminal size={14} className="text-amber-400" />
                Sandboxed Previews
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} AI Engineering Workspace. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/help" className="hover:text-slate-300">
              Documentation & Help
            </Link>
            <span>·</span>
            <Link to="/settings" className="hover:text-slate-300">
              System Settings
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
