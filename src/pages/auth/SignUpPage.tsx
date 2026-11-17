import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  Layers,
  Mail,
  Lock,
  User,
  ArrowRight,
  AlertCircle,
  UserCheck,
  Eye,
  EyeOff,
  CheckCircle2,
  Code2,
  Globe,
  FileText,
  Table2,
} from 'lucide-react';

export function evaluatePasswordStrength(password: string) {
  const hasMinLength = password.length >= 8;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  const score = [hasMinLength, hasMixedCase, hasNumber, hasSymbol].filter(Boolean).length;
  const labels = ['Too Weak', 'Weak', 'Fair', 'Good', 'Strong'];

  return {
    score,
    label: labels[score] || 'Too Weak',
    hasMinLength,
    hasMixedCase,
    hasNumber,
    hasSymbol,
  };
}

export const SignUpPage: React.FC = () => {
  const { registerWithEmail, loginWithGoogle, loginAsGuest } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please confirm your password.');
      return;
    }

    if (!acceptedTerms) {
      setError('Please accept the Terms of Service and Privacy Policy to create an account.');
      return;
    }

    setLoading(true);
    try {
      await registerWithEmail(email, password, fullName.trim());
      navigate('/verify-otp', { replace: true });
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('This email is already registered. Please sign in instead.');
      } else {
        setError(err.message || 'Failed to create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Google Sign-Up could not be completed.');
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
        <div className="lg:col-span-5 p-8 lg:p-10 bg-[#0d0d12] border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-col justify-between">
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
              6-Digit Email OTP Verification
            </p>

            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">
              Create your private engineering workspace.
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-3 leading-relaxed">
              Register to unlock owner-scoped multi-agent projects, automatic guest project
              migration, and verified cloud persistence.
            </p>

            <div className="mt-8 space-y-3">
              <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80 flex items-center gap-3">
                <Code2 size={16} className="text-violet-400 shrink-0" />
                <span className="text-xs text-zinc-200">
                  <strong>01. Code Generator:</strong> Multi-file architecture & immutable versions
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80 flex items-center gap-3">
                <Globe size={16} className="text-indigo-400 shrink-0" />
                <span className="text-xs text-zinc-200">
                  <strong>02. Website Generator:</strong> Sandboxed React/Vite live preview compiler
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80 flex items-center gap-3">
                <FileText size={16} className="text-sky-400 shrink-0" />
                <span className="text-xs text-zinc-200">
                  <strong>03. Document Generator:</strong> Prompt-driven Markdown & native DOCX export
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80 flex items-center gap-3">
                <Table2 size={16} className="text-emerald-400 shrink-0" />
                <span className="text-xs text-zinc-200">
                  <strong>04. Data Cleaner:</strong> Natural-language cleaning & CSV/XLSX export
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-zinc-800/80 text-xs text-zinc-500">
            Any artifacts created in Guest Engineer mode are automatically migrated to your account
            upon verification.
          </div>
        </div>

        {/* Right Panel: Registration Form */}
        <div className="lg:col-span-7 p-8 lg:p-10 flex flex-col justify-center bg-[#111116]">
          <div className="max-w-md w-full mx-auto">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Create your account
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Register with email & password (verified via server-side 6-digit OTP) or Google.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
              >
                <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label
                  htmlFor="signup-name"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="signup-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ada Lovelace"
                    className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-email"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="engineer@company.com"
                    className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="signup-password"
                    className="block text-xs font-medium text-zinc-300 mb-1"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                    />
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 chars"
                      className="w-full pl-10 pr-9 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="signup-confirm-password"
                    className="block text-xs font-medium text-zinc-300 mb-1"
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                    />
                    <input
                      id="signup-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Password Strength Meter & Requirements */}
              <div className="p-3 rounded-lg bg-[#09090b] border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">Password Strength</span>
                  <span
                    data-testid="password-strength-label"
                    className={`font-semibold ${
                      strength.score >= 3
                        ? 'text-emerald-400'
                        : strength.score === 2
                        ? 'text-amber-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    {strength.label}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 2, 3, 4].map((bar) => (
                    <div
                      key={bar}
                      className={`h-1.5 rounded-full transition-colors ${
                        strength.score >= bar
                          ? strength.score >= 3
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                          : 'bg-zinc-800'
                      }`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-zinc-400 pt-0.5">
                  <div className="flex items-center gap-1">
                    <CheckCircle2
                      size={11}
                      className={strength.hasMinLength ? 'text-emerald-400' : 'text-zinc-600'}
                    />
                    <span>8+ characters</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2
                      size={11}
                      className={strength.hasMixedCase ? 'text-emerald-400' : 'text-zinc-600'}
                    />
                    <span>Upper & lowercase</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2
                      size={11}
                      className={strength.hasNumber ? 'text-emerald-400' : 'text-zinc-600'}
                    />
                    <span>Contains number</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2
                      size={11}
                      className={strength.hasSymbol ? 'text-emerald-400' : 'text-zinc-600'}
                    />
                    <span>Contains symbol</span>
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-zinc-300 select-none pt-1">
                <input
                  id="signup-terms"
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 bg-[#09090b] text-violet-600 focus:ring-violet-500"
                />
                <span>
                  I agree to the{' '}
                  <Link to="/help" className="text-violet-400 hover:underline">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link to="/help" className="text-violet-400 hover:underline">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors shadow-md shadow-violet-600/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <span>{loading ? 'Creating account & issuing OTP...' : 'Create Account'}</span>
                <ArrowRight size={15} />
              </button>
            </form>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-[11px] text-zinc-500 font-medium">Or</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleGoogleSignUp}
                disabled={loading}
                className="w-full py-2 px-3 rounded-lg bg-[#09090b] hover:bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 15.25 5 12c0-3.25 3.36-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>Google Sign Up</span>
              </button>

              <button
                type="button"
                onClick={handleGuestMode}
                className="w-full py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UserCheck size={14} />
                <span>Guest Engineer Demo</span>
              </button>
            </div>

            <p className="text-center text-xs text-zinc-400 mt-5">
              Already have an account?{' '}
              <Link to="/signin" className="text-violet-400 hover:text-violet-300 font-semibold">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
