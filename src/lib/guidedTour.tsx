import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './authContext';
import {
  getUserPreferences,
  saveUserPreferences,
  UserWorkspacePreferences,
} from './firestoreService';

import { GUIDED_TOUR_STEPS, GuidedTourStep } from './guidedTourSteps';
export { GUIDED_TOUR_STEPS };
export type { GuidedTourStep };

interface GuidedTourContextValue {
  isWelcomeOpen: boolean;
  isTourActive: boolean;
  currentStepIndex: number;
  currentStep: GuidedTourStep;
  totalSteps: number;
  preferences: UserWorkspacePreferences;
  startTour: (stepIndex?: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => Promise<void>;
  finishTour: () => Promise<void>;
  resetTourPreferences: () => Promise<void>;
}

const GuidedTourContext = createContext<GuidedTourContextValue | undefined>(undefined);

const WORKSPACE_ROUTE_PREFIXES = [
  '/dashboard',
  '/code-generator',
  '/website-generator',
  '/document-generator',
  '/data-cleaner',
  '/projects',
  '/activity',
  '/settings',
  '/help',
];

export const GuidedTourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [preferences, setPreferences] = useState<UserWorkspacePreferences>({
    tourCompleted: false,
    tourSkipped: false,
  });
  const [prefsLoadedForUid, setPrefsLoadedForUid] = useState<string | null>(null);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const isOnWorkspaceRoute = WORKSPACE_ROUTE_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix)
  );

  // Load persisted tour preferences per authenticated / guest UID
  useEffect(() => {
    if (authLoading || !currentUser?.uid) {
      setIsWelcomeOpen(false);
      setIsTourActive(false);
      return;
    }

    let cancelled = false;
    const uid = currentUser.uid;

    getUserPreferences(uid)
      .then((prefs) => {
        if (cancelled) return;
        setPreferences(prefs);
        setPrefsLoadedForUid(uid);

        const searchParams = new URLSearchParams(location.search);
        const autostartSkip = searchParams.get('autostart') === '1';

        if (
          isOnWorkspaceRoute &&
          !prefs.tourCompleted &&
          !prefs.tourSkipped &&
          !autostartSkip &&
          !isTourActive
        ) {
          setIsWelcomeOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) setPrefsLoadedForUid(uid);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, authLoading, isOnWorkspaceRoute]);

  const startTour = useCallback(
    (stepIndex = 0) => {
      const clamped = Math.max(0, Math.min(stepIndex, GUIDED_TOUR_STEPS.length - 1));
      const targetStep = GUIDED_TOUR_STEPS[clamped];
      setIsWelcomeOpen(false);
      setCurrentStepIndex(clamped);
      setIsTourActive(true);
      if (location.pathname !== targetStep.route) {
        navigate(targetStep.route);
      }
    },
    [location.pathname, navigate]
  );

  const skipTour = useCallback(async () => {
    setIsWelcomeOpen(false);
    setIsTourActive(false);
    setCurrentStepIndex(0);
    const nextPrefs: UserWorkspacePreferences = {
      ...preferences,
      tourSkipped: true,
      tourUpdatedAt: new Date().toISOString(),
    };
    setPreferences(nextPrefs);
    if (currentUser?.uid) {
      await saveUserPreferences(currentUser.uid, { tourSkipped: true });
    }
  }, [currentUser?.uid, preferences]);

  const finishTour = useCallback(async () => {
    setIsWelcomeOpen(false);
    setIsTourActive(false);
    setCurrentStepIndex(0);
    const nextPrefs: UserWorkspacePreferences = {
      tourCompleted: true,
      tourSkipped: false,
      tourUpdatedAt: new Date().toISOString(),
    };
    setPreferences(nextPrefs);
    if (currentUser?.uid) {
      await saveUserPreferences(currentUser.uid, {
        tourCompleted: true,
        tourSkipped: false,
      });
    }
  }, [currentUser?.uid]);

  const nextStep = useCallback(() => {
    if (currentStepIndex >= GUIDED_TOUR_STEPS.length - 1) {
      void finishTour();
      return;
    }
    const nextIdx = currentStepIndex + 1;
    const step = GUIDED_TOUR_STEPS[nextIdx];
    setCurrentStepIndex(nextIdx);
    if (location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [currentStepIndex, finishTour, location.pathname, navigate]);

  const prevStep = useCallback(() => {
    if (currentStepIndex <= 0) return;
    const prevIdx = currentStepIndex - 1;
    const step = GUIDED_TOUR_STEPS[prevIdx];
    setCurrentStepIndex(prevIdx);
    if (location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [currentStepIndex, location.pathname, navigate]);

  const resetTourPreferences = useCallback(async () => {
    const resetPrefs: UserWorkspacePreferences = {
      tourCompleted: false,
      tourSkipped: false,
    };
    setPreferences(resetPrefs);
    if (currentUser?.uid) {
      await saveUserPreferences(currentUser.uid, resetPrefs);
    }
  }, [currentUser?.uid]);

  // Keep tour open only on workspace routes
  const visibleWelcome = Boolean(
    isWelcomeOpen &&
      isOnWorkspaceRoute &&
      !isTourActive &&
      prefsLoadedForUid === currentUser?.uid
  );
  const visibleTour = Boolean(isTourActive && isOnWorkspaceRoute);

  return (
    <GuidedTourContext.Provider
      value={{
        isWelcomeOpen: visibleWelcome,
        isTourActive: visibleTour,
        currentStepIndex,
        currentStep: GUIDED_TOUR_STEPS[currentStepIndex] || GUIDED_TOUR_STEPS[0],
        totalSteps: GUIDED_TOUR_STEPS.length,
        preferences,
        startTour,
        nextStep,
        prevStep,
        skipTour,
        finishTour,
        resetTourPreferences,
      }}
    >
      {children}
    </GuidedTourContext.Provider>
  );
};

export function useGuidedTour(): GuidedTourContextValue {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) {
    throw new Error('useGuidedTour must be used within a GuidedTourProvider');
  }
  return ctx;
}
