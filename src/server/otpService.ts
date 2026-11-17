import crypto from 'node:crypto';

export interface OtpRecord {
  email: string;
  uid: string;
  salt: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  resendAvailableAt: number;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
  verifiedAt?: number;
  verificationToken?: string;
}

export interface EmailDeliveryStatus {
  delivered: boolean;
  provider: 'resend' | 'webhook' | 'unconfigured';
  detail: string;
}

export interface OtpSendResult {
  success: boolean;
  error?: string;
  code?: 'RATE_LIMITED' | 'COOLDOWN_ACTIVE' | 'INVALID_INPUT' | 'EMAIL_DELIVERY_FAILED';
  maskedEmail?: string;
  expiresAt?: number;
  resendAvailableAt?: number;
  cooldownSeconds?: number;
  emailDelivery?: EmailDeliveryStatus;
  /**
   * Returned ONLY when NODE_ENV === 'development' AND ALLOW_SANDBOX_OTP === 'true'.
   * Never exposed in production, staging, or default development environments.
   */
  devTestOtpCode?: string;
}

export interface OtpVerifyResult {
  success: boolean;
  verified: boolean;
  verificationToken?: string;
  error?: string;
  code?:
    | 'NOT_FOUND'
    | 'ALREADY_VERIFIED'
    | 'EXPIRED'
    | 'MAX_ATTEMPTS_EXCEEDED'
    | 'INVALID_CODE'
    | 'INVALID_INPUT';
  remainingAttempts?: number;
}

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const OTP_MAX_SENDS_PER_WINDOW = 5;

const EPHEMERAL_DEV_OTP_HMAC_SECRET = crypto.randomBytes(32).toString('hex');

/**
 * Resolves the OTP HMAC secret dynamically so dotenv.config() and runtime-injected
 * platform secrets are always honored. Falls back to an ephemeral key only if unset.
 */
export function getOtpHmacSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OTP_HMAC_SECRET?.trim();
  if (configured) return configured;
  return EPHEMERAL_DEV_OTP_HMAC_SECRET;
}

/**
 * Masks an email address for safe UI display (e.g., `sr***5@gmail.com`).
 */
export function maskEmailAddress(email: string): string {
  const trimmed = (email || '').trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return '***@***';
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length <= 2) {
    return `${local[0] || '*'}***@${domain}`;
  }
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

/**
 * Computes salted HMAC-SHA256 hash of a 6-digit OTP code.
 * Plaintext OTPs are never persisted in storage.
 */
export function hashOtpCode(code: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(code.trim()).digest('hex');
}

/**
 * Performs constant-time verification of a candidate OTP code against a stored hash.
 */
export function verifyOtpHashConstantTime(
  candidateCode: string,
  salt: string,
  expectedHashHex: string
): boolean {
  const candidateHashHex = hashOtpCode(candidateCode, salt);
  const a = Buffer.from(candidateHashHex, 'hex');
  const b = Buffer.from(expectedHashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP string.
 */
export function generateSixDigitOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Signs an unforgeable server verification token binding `(uid, email, verifiedAt)`.
 */
export function signOtpVerificationToken(
  email: string,
  uid: string,
  verifiedAt: number,
  secret: string = getOtpHmacSecret()
): string {
  const cleanEmail = email.trim().toLowerCase();
  const cleanUid = uid.trim();
  const payload = `${cleanUid}|${cleanEmail}|${verifiedAt}`;
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');
  return `${encodedPayload}.${sig}`;
}

/**
 * Verifies a server-issued OTP verification token in constant time.
 */
export function verifyOtpVerificationToken(
  email: string,
  uid: string,
  token: string | undefined,
  secret: string = getOtpHmacSecret()
): boolean {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [encodedPayload, candidateSig] = token.split('.');
  if (!encodedPayload || !candidateSig || !/^[0-9a-f]{64}$/i.test(candidateSig)) {
    return false;
  }

  const expectedSig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');
  const a = Buffer.from(candidateSig.toLowerCase(), 'utf8');
  const b = Buffer.from(expectedSig.toLowerCase(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const [tokenUid, tokenEmail, tokenTimestamp] = decoded.split('|');
    if (
      tokenUid !== uid.trim() ||
      tokenEmail !== email.trim().toLowerCase() ||
      !Number.isFinite(Number(tokenTimestamp))
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Development OTP helpers are strictly opt-in and ONLY permitted in an explicitly
 * configured development environment (`NODE_ENV === 'development'` AND `ALLOW_SANDBOX_OTP === 'true'`).
 * Never enabled in production, staging, or default environments.
 */
export function isDevOtpHelperEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' && env.ALLOW_SANDBOX_OTP === 'true';
}

/**
 * Reports whether an external transactional email provider is configured.
 * RESEND_API_KEY is sufficient on its own; SMTP_WEBHOOK_URL is an optional alternative
 * used only when Resend is unavailable.
 */
export function getEmailProviderStatus(): {
  configured: boolean;
  provider: 'resend' | 'webhook' | 'unconfigured';
} {
  if (process.env.RESEND_API_KEY?.trim()) {
    return { configured: true, provider: 'resend' };
  }
  if (process.env.SMTP_WEBHOOK_URL?.trim()) {
    return { configured: true, provider: 'webhook' };
  }
  return { configured: false, provider: 'unconfigured' };
}

/**
 * Reports safe boolean OTP readiness flags (never exposes secret values).
 */
export function getOtpSecurityStatus(env: NodeJS.ProcessEnv = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const secretConfigured = Boolean(env.OTP_HMAC_SECRET?.trim());
  const emailFromConfigured = Boolean(env.OTP_EMAIL_FROM?.trim());
  const emailStatus = getEmailProviderStatus();
  return {
    otpHmacSecretConfigured: secretConfigured,
    otpEmailFromConfigured: emailFromConfigured,
    usingResendDefaultSender: emailStatus.provider === 'resend' && !emailFromConfigured,
    sandboxOtpEnabled: !isProduction && isDevOtpHelperEnabled(env),
    emailDeliveryConfigured: emailStatus.configured,
    emailProvider: emailStatus.provider,
  };
}

/**
 * Dispatches the 6-digit OTP via a configured transactional email provider (Resend primary,
 * optional SMTP_WEBHOOK_URL fallback only when Resend is unconfigured/unavailable).
 * Never fabricates delivery: if no provider is configured in environment variables, returns
 * `delivered: false` with `provider: 'unconfigured'`.
 */
export async function dispatchTransactionalOtpEmail(
  email: string,
  code: string
): Promise<EmailDeliveryStatus> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const webhookUrl = process.env.SMTP_WEBHOOK_URL?.trim();
  const fromAddress =
    process.env.OTP_EMAIL_FROM?.trim() || 'AI Engineering Workspace <onboarding@resend.dev>';

  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [email],
          subject: 'Your AI Engineering Workspace 6-Digit Verification Code',
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0f1d;color:#f8fafc;border-radius:12px;">
            <h2 style="margin:0 0 12px;color:#ffffff;">Verify Your Email Ownership</h2>
            <p style="color:#94a3b8;font-size:14px;">Enter the following 6-digit verification code in AI Engineering Workspace. This code expires in 10 minutes:</p>
            <div style="margin:20px 0;padding:16px;background:#050811;border:1px solid #1e293b;border-radius:8px;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:6px;text-align:center;color:#60a5fa;">${code}</div>
            <p style="color:#64748b;font-size:12px;">If you did not request this verification code, you can safely ignore this message.</p>
          </div>`,
        }),
      });
      if (response.ok) {
        return {
          delivered: true,
          provider: 'resend',
          detail: 'Dispatched via Resend transactional email API.',
        };
      }
      return {
        delivered: false,
        provider: 'resend',
        detail: `Resend API returned HTTP ${response.status}.`,
      };
    } catch (err: any) {
      return {
        delivered: false,
        provider: 'resend',
        detail: err?.message || 'Resend API request failed.',
      };
    }
  }

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: 'Your AI Engineering Workspace 6-Digit Verification Code',
          code,
        }),
      });
      if (response.ok) {
        return {
          delivered: true,
          provider: 'webhook',
          detail: 'Dispatched via configured SMTP webhook.',
        };
      }
      return {
        delivered: false,
        provider: 'webhook',
        detail: `SMTP webhook returned HTTP ${response.status}.`,
      };
    } catch (err: any) {
      return {
        delivered: false,
        provider: 'webhook',
        detail: err?.message || 'SMTP webhook request failed.',
      };
    }
  }

  return {
    delivered: false,
    provider: 'unconfigured',
    detail:
      'External transactional email provider (RESEND_API_KEY or SMTP_WEBHOOK_URL) is not configured in environment variables.',
  };
}

/**
 * Stateful Server-Side OTP Manager supporting custom clock injection for deterministic unit tests.
 */
export class OtpManager {
  private records = new Map<string, OtpRecord>();
  private sendHistory = new Map<string, number[]>();

  private normalizeKey(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Issues a new 6-digit OTP for `(email, uid)` subject to resend cooldown and rate limits.
   * Returns both the public result and the generated code (for internal server email dispatch only).
   */
  public issueOtpWithRawCode(
    email: string,
    uid: string,
    nowMs: number = Date.now(),
    exposeDevCode: boolean = isDevOtpHelperEnabled()
  ): { result: OtpSendResult; rawCode?: string } {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanUid = (uid || '').trim();

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanUid) {
      return {
        result: {
          success: false,
          code: 'INVALID_INPUT',
          error: 'A valid email address and user ID are required to issue a verification code.',
        },
      };
    }

    const key = this.normalizeKey(cleanEmail);
    const existing = this.records.get(key);

    // 1. Check resend cooldown
    if (existing && !existing.verified && nowMs < existing.resendAvailableAt) {
      const waitSeconds = Math.ceil((existing.resendAvailableAt - nowMs) / 1000);
      return {
        result: {
          success: false,
          code: 'COOLDOWN_ACTIVE',
          cooldownSeconds: waitSeconds,
          resendAvailableAt: existing.resendAvailableAt,
          error: `Please wait ${waitSeconds}s before requesting another code.`,
        },
      };
    }

    // 2. Check sliding window send rate limit
    const recentSends = (this.sendHistory.get(key) || []).filter(
      (ts) => nowMs - ts < OTP_RATE_LIMIT_WINDOW_MS
    );
    if (recentSends.length >= OTP_MAX_SENDS_PER_WINDOW) {
      return {
        result: {
          success: false,
          code: 'RATE_LIMITED',
          error:
            'Too many OTP requests for this email. Please wait 15 minutes before trying again.',
        },
      };
    }

    // 3. Generate CSPRNG 6-digit code & salted HMAC-SHA256 hash
    const rawCode = generateSixDigitOtp();
    const salt = crypto.randomBytes(16).toString('hex');
    const codeHash = hashOtpCode(rawCode, salt);

    const record: OtpRecord = {
      email: cleanEmail,
      uid: cleanUid,
      salt,
      codeHash,
      createdAt: nowMs,
      expiresAt: nowMs + OTP_TTL_MS,
      resendAvailableAt: nowMs + OTP_RESEND_COOLDOWN_MS,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      verified: false,
    };

    this.records.set(key, record);
    recentSends.push(nowMs);
    this.sendHistory.set(key, recentSends);

    const canExposeDevCode =
      process.env.NODE_ENV !== 'production' && Boolean(exposeDevCode);

    return {
      rawCode,
      result: {
        success: true,
        maskedEmail: maskEmailAddress(cleanEmail),
        expiresAt: record.expiresAt,
        resendAvailableAt: record.resendAvailableAt,
        cooldownSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
        ...(canExposeDevCode ? { devTestOtpCode: rawCode } : {}),
      },
    };
  }

  /**
   * Synchronous wrapper used by unit tests and callers that do not need rawCode.
   */
  public issueOtp(
    email: string,
    uid: string,
    nowMs: number = Date.now(),
    exposeDevCode: boolean = isDevOtpHelperEnabled()
  ): OtpSendResult {
    return this.issueOtpWithRawCode(email, uid, nowMs, exposeDevCode).result;
  }

  /**
   * Verifies a 6-digit OTP code against the stored salted hash with brute-force and expiry checks.
   */
  public verifyOtp(
    email: string,
    uid: string,
    code: string,
    nowMs: number = Date.now()
  ): OtpVerifyResult {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanUid = (uid || '').trim();
    const cleanCode = (code || '').trim();

    if (!cleanEmail || !cleanUid || !/^\d{6}$/.test(cleanCode)) {
      return {
        success: false,
        verified: false,
        code: 'INVALID_INPUT',
        error: 'Please enter a valid 6-digit numeric verification code.',
      };
    }

    const key = this.normalizeKey(cleanEmail);
    const record = this.records.get(key);

    if (!record || record.uid !== cleanUid) {
      return {
        success: false,
        verified: false,
        code: 'NOT_FOUND',
        error: 'No active verification code found. Please request a new code.',
      };
    }

    if (record.verified) {
      return {
        success: true,
        verified: true,
        code: 'ALREADY_VERIFIED',
        verificationToken:
          record.verificationToken ||
          signOtpVerificationToken(cleanEmail, cleanUid, record.verifiedAt || nowMs),
      };
    }

    if (nowMs > record.expiresAt) {
      return {
        success: false,
        verified: false,
        code: 'EXPIRED',
        error: 'This verification code has expired. Please request a new 6-digit code.',
      };
    }

    if (record.attempts >= record.maxAttempts) {
      return {
        success: false,
        verified: false,
        code: 'MAX_ATTEMPTS_EXCEEDED',
        remainingAttempts: 0,
        error: 'Maximum verification attempts exceeded. Please request a new code.',
      };
    }

    record.attempts += 1;
    const isMatch = verifyOtpHashConstantTime(cleanCode, record.salt, record.codeHash);

    if (!isMatch) {
      const remaining = Math.max(0, record.maxAttempts - record.attempts);
      if (remaining === 0) {
        return {
          success: false,
          verified: false,
          code: 'MAX_ATTEMPTS_EXCEEDED',
          remainingAttempts: 0,
          error: 'Maximum verification attempts exceeded. This code has been invalidated.',
        };
      }
      return {
        success: false,
        verified: false,
        code: 'INVALID_CODE',
        remainingAttempts: remaining,
        error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      };
    }

    const token = signOtpVerificationToken(cleanEmail, cleanUid, nowMs);
    record.verified = true;
    record.verifiedAt = nowMs;
    record.verificationToken = token;
    // Wipe the hash and salt once verified
    record.codeHash = '';
    record.salt = '';
    this.records.set(key, record);

    return {
      success: true,
      verified: true,
      verificationToken: token,
    };
  }

  /**
   * Returns current OTP status and verifies cryptographic token if provided.
   */
  public getStatus(
    email: string,
    uid: string,
    nowMs: number = Date.now(),
    verificationToken?: string
  ) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanUid = (uid || '').trim();
    const hasValidToken = verifyOtpVerificationToken(cleanEmail, cleanUid, verificationToken);

    const key = this.normalizeKey(cleanEmail);
    const record = this.records.get(key);

    if (!record || record.uid !== cleanUid) {
      return {
        exists: hasValidToken,
        verified: hasValidToken,
        tokenValid: hasValidToken,
        emailProviderConfigured: getEmailProviderStatus().configured,
      };
    }

    const isVerified = Boolean(record.verified || hasValidToken);
    return {
      exists: true,
      verified: isVerified,
      tokenValid: hasValidToken,
      maskedEmail: maskEmailAddress(record.email),
      expiresAt: record.expiresAt,
      expired: !isVerified && nowMs > record.expiresAt,
      remainingAttempts: Math.max(0, record.maxAttempts - record.attempts),
      cooldownSeconds: Math.max(0, Math.ceil((record.resendAvailableAt - nowMs) / 1000)),
      emailProviderConfigured: getEmailProviderStatus().configured,
    };
  }

  /**
   * Clears an unverified pending OTP record (e.g. if mandatory production email dispatch fails).
   */
  public clearPendingRecord(email: string): void {
    const key = this.normalizeKey(email);
    const existing = this.records.get(key);
    if (existing && !existing.verified) {
      this.records.delete(key);
    }
  }

  /**
   * Exposed for unit test inspection to prove plaintext OTPs are never stored.
   */
  public getStoredRecordForInspection(email: string): OtpRecord | undefined {
    const rec = this.records.get(this.normalizeKey(email));
    return rec ? { ...rec } : undefined;
  }
}

export interface OtpSendHttpResponse {
  status: number;
  body: OtpSendResult;
}

/**
 * Handles POST /api/auth/otp/send with strict production safeguards:
 * - Never leaks raw OTP codes in production or when dev helpers are not explicitly enabled.
 * - Requires actual transactional email delivery in production (Resend primary).
 */
export async function processOtpSendRequest(options: {
  email: string;
  uid: string;
  otpManager?: OtpManager;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  sendEmail?: (email: string, code: string) => Promise<EmailDeliveryStatus>;
}): Promise<OtpSendHttpResponse> {
  const env = options.env || process.env;
  const manager = options.otpManager || defaultOtpManager;
  const nowMs = options.nowMs ?? Date.now();
  const sendEmail = options.sendEmail || dispatchTransactionalOtpEmail;

  const isProduction = env.NODE_ENV === 'production';
  const devHelperAllowed = !isProduction && isDevOtpHelperEnabled(env);

  const { result, rawCode } = manager.issueOtpWithRawCode(
    options.email,
    options.uid,
    nowMs,
    devHelperAllowed
  );

  if (!result.success) {
    const status =
      result.code === 'RATE_LIMITED' || result.code === 'COOLDOWN_ACTIVE' ? 429 : 400;
    return { status, body: result };
  }

  const emailDelivery = rawCode
    ? await sendEmail(String(options.email || '').trim(), rawCode)
    : undefined;

  if (isProduction && !emailDelivery?.delivered) {
    manager.clearPendingRecord(options.email);
    return {
      status: 503,
      body: {
        success: false,
        code: 'EMAIL_DELIVERY_FAILED',
        maskedEmail: result.maskedEmail,
        emailDelivery,
        error:
          emailDelivery?.provider === 'unconfigured'
            ? 'Transactional email delivery (RESEND_API_KEY) is required in production to verify your email address.'
            : 'Unable to deliver verification email right now. Please try again shortly.',
      },
    };
  }

  const { devTestOtpCode, ...safeResult } = result;
  return {
    status: 200,
    body: {
      ...safeResult,
      ...(devHelperAllowed && devTestOtpCode ? { devTestOtpCode } : {}),
      emailDelivery,
    },
  };
}

export const defaultOtpManager = new OtpManager();
