import crypto from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json';

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export interface VerifiedFirebaseToken {
  valid: true;
  uid: string;
  email?: string;
  emailVerified: boolean;
}

export interface RejectedFirebaseToken {
  valid: false;
  code:
    | 'MISSING_TOKEN'
    | 'MALFORMED_TOKEN'
    | 'UNSUPPORTED_ALG'
    | 'EXPIRED_TOKEN'
    | 'INVALID_CLAIMS'
    | 'UNKNOWN_KEY_ID'
    | 'INVALID_SIGNATURE'
    | 'CERT_FETCH_FAILED';
  error: string;
}

export type FirebaseTokenVerificationResult = VerifiedFirebaseToken | RejectedFirebaseToken;

interface CertCacheEntry {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let cachedGoogleCerts: CertCacheEntry | null = null;

export function extractBearerToken(authorizationHeader: unknown): string | undefined {
  if (typeof authorizationHeader !== 'string') return undefined;
  const trimmed = authorizationHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return undefined;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

function decodeBase64UrlJson<T = Record<string, unknown>>(segment: string): T | null {
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

async function fetchGoogleSecureTokenCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedGoogleCerts && now < cachedGoogleCerts.expiresAtMs) {
    return cachedGoogleCerts.certs;
  }

  const res = await fetch(FIREBASE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Firebase public keys (HTTP ${res.status})`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 3_600_000;

  cachedGoogleCerts = {
    certs,
    expiresAtMs: now + ttlMs,
  };
  return certs;
}

/**
 * Cryptographically verifies a Firebase Auth ID token (RS256 JWT) on the server.
 * Prevents caller identity spoofing via unverified `ownerId` query params or headers.
 */
export async function verifyFirebaseIdToken(
  token: string | undefined,
  options?: {
    expectedProjectId?: string;
    nowSec?: number;
    clockSkewSec?: number;
    getCerts?: (forceRefresh?: boolean) => Promise<Record<string, string>>;
  }
): Promise<FirebaseTokenVerificationResult> {
  const cleanToken = typeof token === 'string' ? token.trim() : '';
  if (!cleanToken) {
    return {
      valid: false,
      code: 'MISSING_TOKEN',
      error: 'Missing Firebase ID token.',
    };
  }

  const parts = cleanToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return {
      valid: false,
      code: 'MALFORMED_TOKEN',
      error: 'Malformed Firebase ID token.',
    };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: unknown; kid?: unknown }>(headerB64);
  const payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64);

  if (!header || !payload) {
    return {
      valid: false,
      code: 'MALFORMED_TOKEN',
      error: 'Malformed Firebase ID token header or payload.',
    };
  }

  // Strictly enforce RS256 and a string key ID (blocks alg:none and HS256 key-confusion)
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    return {
      valid: false,
      code: 'UNSUPPORTED_ALG',
      error: 'Unsupported Firebase ID token algorithm or missing key ID.',
    };
  }

  const expectedProjectId = options?.expectedProjectId || firebaseConfig.projectId;
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const clockSkewSec = options?.clockSkewSec ?? 60;

  const exp = payload.exp;
  const iat = payload.iat;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= nowSec - clockSkewSec) {
    return {
      valid: false,
      code: 'EXPIRED_TOKEN',
      error: 'Firebase ID token has expired.',
    };
  }
  if (typeof iat !== 'number' || !Number.isFinite(iat) || iat > nowSec + clockSkewSec) {
    return {
      valid: false,
      code: 'INVALID_CLAIMS',
      error: 'Firebase ID token issued-at timestamp is invalid.',
    };
  }

  if (payload.aud !== expectedProjectId || payload.iss !== expectedIssuer) {
    return {
      valid: false,
      code: 'INVALID_CLAIMS',
      error: 'Firebase ID token audience or issuer does not match this project.',
    };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const userIdClaim = typeof payload.user_id === 'string' ? payload.user_id.trim() : undefined;
  if (!sub || !VALID_UID_RE.test(sub) || (userIdClaim !== undefined && userIdClaim !== sub)) {
    return {
      valid: false,
      code: 'INVALID_CLAIMS',
      error: 'Firebase ID token subject claim is invalid.',
    };
  }

  const getCerts = options?.getCerts || fetchGoogleSecureTokenCerts;
  let certs: Record<string, string>;
  try {
    certs = await getCerts(false);
    if (!certs[header.kid]) {
      certs = await getCerts(true);
    }
  } catch {
    return {
      valid: false,
      code: 'CERT_FETCH_FAILED',
      error: 'Unable to retrieve Firebase verification keys.',
    };
  }

  const pemCert = certs[header.kid];
  if (typeof pemCert !== 'string' || !pemCert.includes('BEGIN ')) {
    return {
      valid: false,
      code: 'UNKNOWN_KEY_ID',
      error: 'Firebase ID token key ID is unrecognized.',
    };
  }

  try {
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(signatureB64, 'base64url');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingInput);
    verifier.end();
    const isVerified = verifier.verify(pemCert, signature);
    if (!isVerified) {
      return {
        valid: false,
        code: 'INVALID_SIGNATURE',
        error: 'Firebase ID token signature verification failed.',
      };
    }
  } catch {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      error: 'Firebase ID token signature verification failed.',
    };
  }

  return {
    valid: true,
    uid: sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
  };
}
