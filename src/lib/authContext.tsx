import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  signInWithPopup,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { migrateGuestWorkspaceData } from './firestoreService';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest?: boolean;
  emailOtpVerified?: boolean;
}

export interface OtpDispatchMetadata {
  maskedEmail: string;
  expiresAt: number;
  cooldownSeconds: number;
  emailDelivery?: {
    delivered: boolean;
    provider: 'resend' | 'webhook' | 'unconfigured';
    detail: string;
  };
  devTestOtpCode?: string;
}

interface AuthContextType {
  currentUser: AppUser | null;
  loading: boolean;
  requiresOtpVerification: boolean;
  otpMetadata: OtpDispatchMetadata | null;
  lastMigratedProjectCount: number;
  clearMigrationBanner: () => void;
  loginWithEmail: (email: string, pass: string, rememberMe?: boolean) => Promise<void>;
  registerWithEmail: (
    email: string,
    pass: string,
    name: string
  ) => Promise<OtpDispatchMetadata>;
  sendSignupOtp: () => Promise<OtpDispatchMetadata>;
  verifySignupOtp: (code: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginAsGuest: () => void;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const GUEST_STORAGE_KEY = 'ai_workspace_guest_user';
const PENDING_OTP_UID_KEY = 'ai_workspace_pending_otp_uid';
const OTP_TOKEN_PREFIX = 'ai_workspace_otp_token_';
const DEFAULT_GUEST_UID = 'guest_engineer_demo';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [requiresOtpVerification, setRequiresOtpVerification] = useState(false);
  const [otpMetadata, setOtpMetadata] = useState<OtpDispatchMetadata | null>(null);
  const [lastMigratedProjectCount, setLastMigratedProjectCount] = useState(0);

  const clearMigrationBanner = () => setLastMigratedProjectCount(0);

  // Sync user profile to Firestore when signed in
  const syncUserProfile = async (user: User, customName?: string) => {
    try {
      const pendingOtpUid = localStorage.getItem(PENDING_OTP_UID_KEY);
      if (pendingOtpUid === user.uid && !user.emailVerified) {
        return;
      }
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      const now = new Date().toISOString();
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email || '',
          displayName: customName || user.displayName || 'Engineer',
          photoURL: user.photoURL || '',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await setDoc(
          userRef,
          {
            updatedAt: now,
            displayName: customName || user.displayName || snap.data()?.displayName || 'Engineer',
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn('Could not sync user profile to Firestore (may be offline or unverified):', err);
    }
  };

  // Run safe, idempotent migration of any guest projects to the authenticated account
  const performGuestMigrationIfNeeded = async (targetUid: string) => {
    try {
      const result = await migrateGuestWorkspaceData(DEFAULT_GUEST_UID, targetUid);
      if (result.migratedCount > 0) {
        setLastMigratedProjectCount(result.migratedCount);
      }
    } catch (err) {
      console.warn('Guest migration warning:', err);
    }
  };

  // Verify OTP status against trusted backend endpoint (/api/auth/otp/status)
  const checkBackendOtpStatus = async (email: string, uid: string): Promise<boolean> => {
    try {
      const storedToken = localStorage.getItem(`${OTP_TOKEN_PREFIX}${uid}`) || '';
      const params = new URLSearchParams({
        email,
        uid,
        ...(storedToken ? { token: storedToken } : {}),
      });
      const res = await fetch(`/api/auth/otp/status?${params.toString()}`);
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data.verified);
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const storedGuest = localStorage.getItem(GUEST_STORAGE_KEY);
    if (storedGuest) {
      try {
        const guestUser = JSON.parse(storedGuest);
        setCurrentUser(guestUser);
        setLoading(false);
      } catch {
        localStorage.removeItem(GUEST_STORAGE_KEY);
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        localStorage.removeItem(GUEST_STORAGE_KEY);
        const pendingOtpUid = localStorage.getItem(PENDING_OTP_UID_KEY);
        const isPendingSignup = pendingOtpUid === user.uid;

        let isOtpVerified = true;
        if (isPendingSignup && !user.emailVerified) {
          isOtpVerified = await checkBackendOtpStatus(user.email || '', user.uid);
        }

        setRequiresOtpVerification(isPendingSignup && !isOtpVerified);

        setCurrentUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || 'Engineer',
          photoURL: user.photoURL,
          isGuest: false,
          emailOtpVerified: isOtpVerified,
        });

        if (isOtpVerified) {
          localStorage.removeItem(PENDING_OTP_UID_KEY);
          await performGuestMigrationIfNeeded(user.uid);
        }
        await syncUserProfile(user);
      } else if (!localStorage.getItem(GUEST_STORAGE_KEY)) {
        setCurrentUser(null);
        setRequiresOtpVerification(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const requestOtpFromServer = async (
    email: string,
    uid: string
  ): Promise<OtpDispatchMetadata> => {
    const res = await fetch('/api/auth/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, uid }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to send 6-digit verification code.');
    }
    const devHelperActive =
      !import.meta.env.PROD &&
      import.meta.env.DEV &&
      import.meta.env.VITE_ENABLE_DEV_OTP_HELPER === 'true';

    const meta: OtpDispatchMetadata = {
      maskedEmail: data.maskedEmail || email,
      expiresAt: data.expiresAt || Date.now() + 10 * 60 * 1000,
      cooldownSeconds: data.cooldownSeconds || 60,
      emailDelivery: data.emailDelivery,
      ...(devHelperActive && typeof data.devTestOtpCode === 'string'
        ? { devTestOtpCode: data.devTestOtpCode }
        : {}),
    };
    setOtpMetadata(meta);
    return meta;
  };

  const loginWithEmail = async (email: string, pass: string, rememberMe = true) => {
    try {
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence
      );
    } catch {
      // Fallback if persistence setting is unsupported in environment
    }
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    // Normal password login does not force signup OTP gate
    localStorage.removeItem(PENDING_OTP_UID_KEY);
    setRequiresOtpVerification(false);
    await performGuestMigrationIfNeeded(cred.user.uid);
    await syncUserProfile(cred.user);
  };

  const registerWithEmail = async (
    email: string,
    pass: string,
    name: string
  ): Promise<OtpDispatchMetadata> => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name && cred.user) {
      await updateProfile(cred.user, { displayName: name });
    }
    // Require backend-enforced 6-digit email OTP verification before entering workspace
    localStorage.setItem(PENDING_OTP_UID_KEY, cred.user.uid);
    localStorage.removeItem(`${OTP_TOKEN_PREFIX}${cred.user.uid}`);
    setRequiresOtpVerification(true);

    setCurrentUser({
      uid: cred.user.uid,
      email: cred.user.email || email,
      displayName: name || cred.user.displayName || 'Engineer',
      photoURL: cred.user.photoURL,
      isGuest: false,
      emailOtpVerified: false,
    });

    const meta = await requestOtpFromServer(email, cred.user.uid);
    await syncUserProfile(cred.user, name);
    return meta;
  };

  const sendSignupOtp = async (): Promise<OtpDispatchMetadata> => {
    const user = auth.currentUser || currentUser;
    if (!user || !user.email) {
      throw new Error('No active signup email found to send verification code.');
    }
    return requestOtpFromServer(user.email, user.uid);
  };

  const verifySignupOtp = async (code: string): Promise<void> => {
    const user = auth.currentUser || currentUser;
    if (!user || !user.email) {
      throw new Error('Session expired. Please sign in or register again.');
    }
    const res = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        uid: user.uid,
        code: code.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.verified) {
      throw new Error(data.error || 'Invalid or expired verification code.');
    }

    if (data.verificationToken) {
      localStorage.setItem(`${OTP_TOKEN_PREFIX}${user.uid}`, data.verificationToken);
    }
    localStorage.removeItem(PENDING_OTP_UID_KEY);
    setRequiresOtpVerification(false);
    setOtpMetadata(null);
    setCurrentUser((prev) => (prev ? { ...prev, emailOtpVerified: true } : null));

    await performGuestMigrationIfNeeded(user.uid);
  };

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    localStorage.removeItem(PENDING_OTP_UID_KEY);
    setRequiresOtpVerification(false);
    await performGuestMigrationIfNeeded(cred.user.uid);
    await syncUserProfile(cred.user);
  };

  const loginAsGuest = () => {
    const guest: AppUser = {
      uid: DEFAULT_GUEST_UID,
      email: 'guest@aiengineering.workspace',
      displayName: 'Guest Engineer',
      photoURL: null,
      isGuest: true,
      emailOtpVerified: true,
    };
    localStorage.removeItem(PENDING_OTP_UID_KEY);
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
    setRequiresOtpVerification(false);
    setCurrentUser(guest);
  };

  const logout = async () => {
    localStorage.removeItem(GUEST_STORAGE_KEY);
    localStorage.removeItem(PENDING_OTP_UID_KEY);
    setRequiresOtpVerification(false);
    setOtpMetadata(null);
    if (auth.currentUser) {
      await signOut(auth);
    }
    setCurrentUser(null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const updateUserProfile = async (name: string) => {
    if (currentUser?.isGuest) {
      const updated = { ...currentUser, displayName: name };
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(updated));
      setCurrentUser(updated);
      return;
    }
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: name });
      setCurrentUser((prev) => (prev ? { ...prev, displayName: name } : null));
      await syncUserProfile(auth.currentUser, name);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
        requiresOtpVerification,
        otpMetadata,
        lastMigratedProjectCount,
        clearMigrationBanner,
        loginWithEmail,
        registerWithEmail,
        sendSignupOtp,
        verifySignupOtp,
        loginWithGoogle,
        loginAsGuest,
        logout,
        resetPassword,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
