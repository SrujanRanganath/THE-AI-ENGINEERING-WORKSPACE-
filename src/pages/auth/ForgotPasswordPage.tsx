import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { Layers, Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';

export const ForgotPasswordPage: React.FC = () => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await resetPassword(cleanEmail);
    } catch {
      // Uniform confirmation flow: intentionally do not reveal whether an email exists in the database
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] bg-architectural-grid text-zinc-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 text-base font-semibold tracking-tight text-white"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-violet-600/25 ring-1 ring-white/15">
              <Layers size={17} />
            </span>
            <span>AI Engineering Workspace</span>
          </Link>
        </div>

        <div className="p-7 rounded-2xl bg-[#111116] border border-zinc-800/90 shadow-2xl space-y-5">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-white tracking-tight">Reset your password</h1>
            <p className="text-xs text-zinc-400">
              Enter your registered email address to request password recovery instructions.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
            >
              <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {submitted ? (
            <div
              data-testid="reset-confirmation-panel"
              className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3"
            >
              <CheckCircle2 size={26} className="text-emerald-400 mx-auto" />
              <div className="text-xs text-emerald-200 font-medium leading-relaxed">
                If an account is associated with <strong>{email}</strong>, password reset
                instructions have been dispatched via Firebase Authentication.
              </div>
              <Link
                to="/signin"
                className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 font-semibold pt-1"
              >
                <ArrowLeft size={14} />
                <span>Return to Sign In</span>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="reset-email"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  Account Email
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="engineer@company.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors shadow-md shadow-violet-600/20 disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Processing Request...' : 'Send Reset Instructions'}
              </button>
            </form>
          )}

          {!submitted && (
            <div className="pt-2 text-center">
              <Link
                to="/signin"
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                <ArrowLeft size={14} />
                <span>Back to Sign In</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
