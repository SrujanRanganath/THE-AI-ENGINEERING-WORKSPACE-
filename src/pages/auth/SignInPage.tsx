import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  Layers,
  Mail,
  Lock,
  ArrowRight,
  AlertCircle,
  UserCheck,
  Eye,
  EyeOff,
  Code2,
  Globe,
  FileText,
  Table2,
} from 'lucide-react';

const AGENT_HIGHLIGHTS = [
  {
    icon: Code2,
    title: '01. Code Generator',
    desc: 'Multi-file software architecture, diff previews, immutable version snapshots, and ZIP export.',
    color: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  },
  {
    icon: Globe,
    title: '02. Website Generator',
    desc: 'Complete React/Vite manifests with an in-browser compiler and opaque-origin sandbox preview.',
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  },
  {
    icon: FileText,
    title: '03. Document Generator',
    desc: 'Prompt-driven structured reports, live Markdown editing, and OpenXML .docx compilation.',
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  },
  {
    icon: Table2,
    title: '04. Data Cleaner',
    desc: 'Natural-language CSV/XLSX cleaning, statistical profiling, and non-destructive exports.',
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
];

export const SignInPage: React.FC = () => {
  const { loginWithEmail, loginWithGoogle, loginAsGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await loginWithEmail(email, password, rememberMe);
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error(err);
      if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/user-not-found'
      ) {
        setError('Invalid email or password. Please verify your credentials.');
      } else {
        setError(err.message || 'Failed to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Google Sign-In could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestMode = () => {
    loginAsGuest();
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#09090b] bg-architectural-grid text-zinc-100 flex flex-col justify-center p-4 lg:p-8">
      <div className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 rounded-2xl bg-[#111116] border border-zinc-800/90 shadow-2xl overflow-hidden">
        {/* Left Panel: Brand & Four AI Agent Highlights */}
        <div className="lg:col-span-6 p-8 lg:p-10 bg-[#0d0d12] border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-col justify-between">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 text-base font-semibold tracking-tight text-white mb-8"
            >
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-violet-600/25 ring-1 ring-white/15">
                <Layers size={17} />
              </span>
              <span>AI Engineering Workspace</span>
            </Link>

            <p className="text-xs font-mono uppercase tracking-wider text-violet-400 mb-2">
              One Workspace · Four Intelligent Agents · Infinite Possibilities
            </p>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight leading-tight">
              Access your engineering command center.
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-3 leading-relaxed max-w-md">
              Private owner-scoped repositories, live React/Vite preview compilation, OpenXML
              document publishing, and statistical dataset cleaning.
            </p>

            <div className="mt-8 space-y-3">
              {AGENT_HIGHLIGHTS.map((agent) => {
                const Icon = agent.icon;
                return (
                  <div
                    key={agent.title}
                    className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80 flex items-start gap-3"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${agent.color}`}
                    >
                      <Icon size={16} />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-white">{agent.title}</h3>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                        {agent.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
            <span>Owner-Scoped Firestore Isolation</span>
            <span>Guest-to-Account Migration</span>
          </div>
        </div>

        {/* Right Panel: Sign In Form */}
        <div className="lg:col-span-6 p-8 lg:p-10 flex flex-col justify-center bg-[#111116]">
          <div className="max-w-md w-full mx-auto">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white tracking-tight">Sign in to Workspace</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Authenticate with your email and password, Google account, or launch Guest Engineer
                mode.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
              >
                <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="signin-email"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="signin-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="engineer@company.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="signin-password"
                    className="block text-xs font-medium text-zinc-300"
                  >
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="signin-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-zinc-700 bg-[#09090b] text-violet-600 focus:ring-violet-500"
                  />
                  <span>Remember session on this device</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors shadow-md shadow-violet-600/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                <ArrowRight size={15} />
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-[11px] text-zinc-500 font-medium">Or continue with</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-[#09090b] hover:bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 15.25 5 12c0-3.25 3.36-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <button
                type="button"
                onClick={handleGuestMode}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserCheck size={15} />
                <span>Explore as Guest Engineer (Instant Demo)</span>
              </button>
            </div>

            <p className="text-center text-xs text-zinc-400 mt-6">
              Don't have an account?{' '}
              <Link to="/signup" className="text-violet-400 hover:text-violet-300 font-semibold">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
