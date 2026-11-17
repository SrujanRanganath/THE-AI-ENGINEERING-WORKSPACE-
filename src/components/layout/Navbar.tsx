import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../common/Logo';
import { useAuth } from '../../lib/authContext';
import { Menu, X, ArrowRight, User } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { currentUser } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-[#09090b]/90 border-b border-zinc-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Logo to="/" showTagline={false} />

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
          <Link to="/" className="hover:text-white transition-colors">
            Home
          </Link>
          <Link to="/features" className="hover:text-white transition-colors">
            Features
          </Link>
          <a href="/#agents" className="hover:text-white transition-colors">
            Four Agents
          </a>
          <a href="/#architecture" className="hover:text-white transition-colors">
            Architecture
          </a>
        </nav>

        {/* Desktop Action Buttons */}
        <div className="hidden md:flex items-center gap-3">
          {currentUser ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-all shadow-sm shadow-violet-600/20"
            >
              <User size={15} />
              Open Workspace
            </Link>
          ) : (
            <>
              <Link
                to="/signin"
                className="px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-all shadow-sm shadow-violet-600/20"
              >
                Get Started
                <ArrowRight size={14} />
              </Link>
            </>
          )}
        </div>

        {/* Mobile Hamburger */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60"
          aria-label="Toggle mobile menu"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-zinc-800/80 bg-[#111116] px-4 pt-3 pb-5 space-y-3">
          <div className="flex flex-col space-y-2 text-sm text-zinc-300">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="px-2 py-1.5 hover:text-white"
            >
              Home
            </Link>
            <Link
              to="/features"
              onClick={() => setMobileMenuOpen(false)}
              className="px-2 py-1.5 hover:text-white"
            >
              Features
            </Link>
            <a
              href="/#agents"
              onClick={() => setMobileMenuOpen(false)}
              className="px-2 py-1.5 hover:text-white"
            >
              Four Agents
            </a>
            <a
              href="/#architecture"
              onClick={() => setMobileMenuOpen(false)}
              className="px-2 py-1.5 hover:text-white"
            >
              Architecture
            </a>
          </div>

          <div className="pt-3 border-t border-zinc-800 flex flex-col gap-2">
            {currentUser ? (
              <Link
                to="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold"
              >
                Open Workspace
              </Link>
            ) : (
              <>
                <Link
                  to="/signin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center px-4 py-2 rounded-lg border border-zinc-700 text-zinc-200 text-xs font-medium"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
