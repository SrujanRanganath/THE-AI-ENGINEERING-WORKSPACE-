import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Terminal,
  Info,
} from 'lucide-react';

function maskEmailClient(email: string): string {
  const trimmed = (email || '').trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return '***@***';
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

const SHOW_DEV_OTP_HELPER =
  !import.meta.env.PROD &&
  import.meta.env.DEV &&
  import.meta.env.VITE_ENABLE_DEV_OTP_HELPER === 'true';

export const VerifyOtpPage: React.FC = () => {
  const {
    currentUser,
    requiresOtpVerification,
    otpMetadata,
    sendSignupOtp,
    verifySignupOtp,
    logout,
  } = useAuth();
  const navigate = useNavigate();

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [cooldown, setCooldown] = useState<number>(otpMetadata?.cooldownSeconds || 60);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [testCode, setTestCode] = useState<string | undefined>(
    SHOW_DEV_OTP_HELPER ? otpMetadata?.devTestOtpCode : undefined
  );

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/signup', { replace: true });
      return;
    }
    if (!requiresOtpVerification && currentUser.emailOtpVerified) {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, requiresOtpVerification, navigate]);

  useEffect(() => {
    if (SHOW_DEV_OTP_HELPER && otpMetadata?.devTestOtpCode) {
      setTestCode(otpMetadata.devTestOtpCode);
    }
    if (otpMetadata?.cooldownSeconds) {
      setCooldown(otpMetadata.cooldownSeconds);
    }
  }, [otpMetadata]);

  // Request an initial OTP if the user landed here on page refresh without active metadata
  useEffect(() => {
    if (currentUser && requiresOtpVerification && !otpMetadata) {
      sendSignupOtp()
        .then((meta) => {
          if (SHOW_DEV_OTP_HELPER && meta.devTestOtpCode) {
            setTestCode(meta.devTestOtpCode);
          }
          setCooldown(meta.cooldownSeconds);
        })
        .catch(() => {
          // Cooldown may already be active
        });
    }
  }, [currentUser, requiresOtpVerification, otpMetadata, sendSignupOtp]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleDigitChange = (index: number, rawVal: string) => {
    const cleanDigit = rawVal.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = cleanDigit;
    setDigits(next);
    setError(null);

    if (cleanDigit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || '';
    }
    setDigits(next);
    setError(null);
    const focusIdx = Math.min(5, pasted.length - 1);
    inputRefs.current[focusIdx]?.focus();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullCode = digits.join('');
    if (fullCode.length !== 6) {
      setError('Please enter all 6 digits of your verification code.');
      return;
    }

    setVerifying(true);
    setError(null);
    setStatusMsg(null);
    try {
      await verifySignupOtp(fullCode);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check the code and try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setStatusMsg(null);
    try {
      const meta = await sendSignupOtp();
      setCooldown(meta.cooldownSeconds || 60);
      setTestCode(SHOW_DEV_OTP_HELPER ? meta.devTestOtpCode : undefined);
      setDigits(['', '', '', '', '', '']);
      setStatusMsg('A fresh 6-digit verification code has been sent to your email.');
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Could not resend verification code.');
    } finally {
      setResending(false);
    }
  };

  const handleChangeEmail = async () => {
    await logout();
    navigate('/signup', { replace: true });
  };

  const maskedDisplay =
    otpMetadata?.maskedEmail || maskEmailClient(currentUser?.email || 'user@domain.com');
  const emailDelivery = otpMetadata?.emailDelivery;

  return (
    <div className="min-h-screen bg-[#09090b] bg-architectural-grid text-zinc-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="p-7 rounded-2xl bg-[#111116] border border-zinc-800/90 shadow-2xl space-y-5">
          <div className="w-11 h-11 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mx-auto">
            <ShieldCheck size={22} />
          </div>

          <div className="text-center space-y-1.5">
            <h1 className="text-xl font-bold text-white tracking-tight">
              Verify Your Email Ownership
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Enter the 6-digit verification code sent to{' '}
              <span
                data-testid="masked-email-display"
                className="text-white font-mono font-semibold"
              >
                {maskedDisplay}
              </span>
              . Code expires in 10 minutes.
            </p>
          </div>

          {/* Honest Email Delivery Status Notice */}
          {emailDelivery && !emailDelivery.delivered && (
            <div className="p-3 rounded-xl bg-[#09090b] border border-zinc-800 text-[11px] text-zinc-300 flex items-start gap-2.5">
              <Info size={14} className="text-violet-400 shrink-0 mt-0.5" />
              <span>
                <strong>Email Delivery Status:</strong> {emailDelivery.detail}
              </span>
            </div>
          )}

          {/* Development-Only Sandbox OTP Helper (Stripped from production builds) */}
          {!import.meta.env.PROD && SHOW_DEV_OTP_HELPER && testCode && (
            <div
              data-testid="dev-otp-banner"
              className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-indigo-400 shrink-0" />
                <span>
                  Dev Sandbox OTP:{' '}
                  <strong
                    data-testid="dev-otp-code"
                    className="font-mono text-white tracking-wider"
                  >
                    {testCode}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDigits(testCode.split('').slice(0, 6));
                  setError(null);
                }}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors cursor-pointer"
              >
                Fill Code
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              data-testid="otp-error-alert"
              className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2"
            >
              <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {statusMsg && (
            <div
              role="status"
              className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2"
            >
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>{statusMsg}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-5">
            <div className="flex items-center justify-between gap-2">
              {digits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  aria-label={`Verification digit ${idx + 1}`}
                  data-testid={`otp-digit-${idx}`}
                  value={digit}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  onPaste={handlePaste}
                  className="w-12 h-13 text-center text-lg font-bold font-mono rounded-xl bg-[#09090b] border border-zinc-700 text-white focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 transition-all"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={verifying || digits.join('').length !== 6}
              className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors shadow-md shadow-violet-600/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <span>{verifying ? 'Verifying Code...' : 'Verify & Open Workspace'}</span>
              <ArrowRight size={15} />
            </button>
          </form>

          <div className="pt-4 border-t border-zinc-800 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              className="inline-flex items-center gap-1.5 text-violet-400 hover:text-violet-300 disabled:text-zinc-500 disabled:cursor-not-allowed font-medium transition-colors"
            >
              <RefreshCw size={13} className={resending ? 'animate-spin' : ''} />
              <span className="tabular-nums">
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend 6-digit code'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleChangeEmail}
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft size={13} />
              <span>Change email</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
