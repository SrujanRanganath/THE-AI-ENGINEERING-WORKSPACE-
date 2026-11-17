import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/authContext';
import { GuidedTourProvider } from './lib/guidedTour';
import { GuidedTourOverlay } from './components/common/GuidedTourOverlay';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { WorkspaceLayout } from './components/layout/WorkspaceLayout';

// Public Pages
import { LandingPage } from './pages/public/LandingPage';
import { FeaturesPage } from './pages/public/FeaturesPage';
import { SignInPage } from './pages/auth/SignInPage';
import { SignUpPage } from './pages/auth/SignUpPage';
import { VerifyOtpPage } from './pages/auth/VerifyOtpPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { PublishedWebsitePage } from './pages/public/PublishedWebsitePage';

// Authenticated Workspace Pages (Lazy-Loaded)
const DashboardPage = lazy(() =>
  import('./pages/workspace/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const CodeGeneratorPage = lazy(() =>
  import('./pages/workspace/CodeGeneratorPage').then((m) => ({ default: m.CodeGeneratorPage }))
);
const WebsiteGeneratorPage = lazy(() =>
  import('./pages/workspace/WebsiteGeneratorPage').then((m) => ({ default: m.WebsiteGeneratorPage }))
);
const DocumentGeneratorPage = lazy(() =>
  import('./pages/workspace/DocumentGeneratorPage').then((m) => ({ default: m.DocumentGeneratorPage }))
);
const DataCleanerPage = lazy(() =>
  import('./pages/workspace/DataCleanerPage').then((m) => ({ default: m.DataCleanerPage }))
);
const ProjectsPage = lazy(() =>
  import('./pages/workspace/ProjectsPage').then((m) => ({ default: m.ProjectsPage }))
);
const ActivityPage = lazy(() =>
  import('./pages/workspace/ActivityPage').then((m) => ({ default: m.ActivityPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/workspace/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const HelpPage = lazy(() =>
  import('./pages/workspace/HelpPage').then((m) => ({ default: m.HelpPage }))
);

const StudioLoadingFallback = () => (
  <div className="flex-1 flex items-center justify-center min-h-[480px]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      <span className="text-xs font-mono text-zinc-400">Loading studio engine...</span>
    </div>
  </div>
);

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <GuidedTourProvider>
          <GuidedTourOverlay />
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/verify-otp" element={<VerifyOtpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/published/:projectId" element={<PublishedWebsitePage />} />

          {/* Authenticated Workspace Routes */}
          <Route
            element={
              <ProtectedRoute>
                <WorkspaceLayout />
              </ProtectedRoute>
            }
          >
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="/code-generator"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <CodeGeneratorPage />
                </Suspense>
              }
            />
            <Route
              path="/website-generator"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <WebsiteGeneratorPage />
                </Suspense>
              }
            />
            <Route
              path="/document-generator"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <DocumentGeneratorPage />
                </Suspense>
              }
            />
            <Route
              path="/data-cleaner"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <DataCleanerPage />
                </Suspense>
              }
            />
            <Route
              path="/projects"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <ProjectsPage />
                </Suspense>
              }
            />
            <Route
              path="/activity"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <ActivityPage />
                </Suspense>
              }
            />
            <Route
              path="/settings"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <SettingsPage />
                </Suspense>
              }
            />
            <Route
              path="/help"
              element={
                <Suspense fallback={<StudioLoadingFallback />}>
                  <HelpPage />
                </Suspense>
              }
            />
          </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </GuidedTourProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
