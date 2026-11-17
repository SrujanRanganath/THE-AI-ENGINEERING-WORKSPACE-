import React, { useState } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../../lib/authContext';
import { useGuidedTour } from '../../lib/guidedTour';
import { Menu, CheckCircle2, FolderGit2, Compass } from 'lucide-react';

export const WorkspaceLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { currentUser, lastMigratedProjectCount, clearMigrationBanner } = useAuth();
  const { startTour } = useGuidedTour();
  const location = useLocation();

  const getRouteTitle = () => {
    const path = location.pathname;
    if (path.includes('/dashboard')) return 'Dashboard';
    if (path.includes('/code-generator')) return 'Code Generator';
    if (path.includes('/website-generator')) return 'Website Generator';
    if (path.includes('/document-generator')) return 'Document Generator';
    if (path.includes('/data-cleaner')) return 'Data Cleaner';
    if (path.includes('/projects')) return 'My Projects';
    if (path.includes('/activity')) return 'Recent Activity';
    if (path.includes('/settings')) return 'Settings';
    if (path.includes('/help')) return 'Help & Documentation';
    return 'Workspace';
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex text-zinc-100">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Clean Emergent Top Header Bar */}
        <header className="h-14 px-4 sm:px-6 lg:px-8 border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-md flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/70 shrink-0 cursor-pointer"
              aria-label="Open sidebar menu"
            >
              <Menu size={19} />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <Link
                to="/dashboard"
                className="text-zinc-400 hover:text-zinc-200 hidden sm:inline transition-colors whitespace-nowrap shrink-0"
              >
                Workspace
              </Link>
              <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-zinc-100 text-sm truncate">
                {getRouteTitle()}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => startTour(0)}
              data-testid="topbar-guided-tour-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Compass size={13} className="text-violet-400" />
              <span>Guided Tour</span>
            </button>

            <Link
              to="/projects"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111116] hover:bg-zinc-800/80 border border-zinc-800 text-xs font-medium text-zinc-200 transition-colors whitespace-nowrap shrink-0"
            >
              <FolderGit2 size={13} className="text-zinc-400" />
              <span>My Projects</span>
            </Link>

            <Link
              to="/settings"
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800/70 text-zinc-200 transition-colors whitespace-nowrap shrink-0"
              title="Account & Workspace Settings"
            >
              <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-xs font-semibold text-white">
                {currentUser?.displayName ? currentUser.displayName[0].toUpperCase() : 'E'}
              </div>
              <span className="hidden lg:inline text-xs font-medium text-zinc-300 max-w-[140px] truncate">
                {currentUser?.displayName || 'Engineer'}
              </span>
            </Link>
          </div>
        </header>

        {lastMigratedProjectCount > 0 && (
          <div
            data-testid="guest-migration-banner"
            className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
              <span>
                Successfully migrated <strong>{lastMigratedProjectCount}</strong> guest workspace
                item{lastMigratedProjectCount === 1 ? '' : 's'} to your authenticated account.
              </span>
            </div>
            <button
              type="button"
              onClick={clearMigrationBanner}
              className="text-emerald-300 hover:text-white text-[11px] font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
