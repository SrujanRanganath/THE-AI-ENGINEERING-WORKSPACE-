import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { useGuidedTour } from '../../lib/guidedTour';
import { Logo } from '../common/Logo';
import {
  LayoutDashboard,
  Code2,
  Globe,
  FileText,
  Table2,
  FolderGit2,
  Activity,
  Settings,
  HelpCircle,
  Compass,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const { currentUser, logout } = useAuth();
  const { startTour } = useGuidedTour();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/signin');
  };

  const navGroups = [
    {
      heading: 'Workspace',
      items: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }],
    },
    {
      heading: 'Agents',
      items: [
        { label: 'Code Generator', path: '/code-generator', icon: Code2, num: '01' },
        { label: 'Website Generator', path: '/website-generator', icon: Globe, num: '02' },
        { label: 'Data Cleaner', path: '/data-cleaner', icon: Table2, num: '03' },
        { label: 'Document Generator', path: '/document-generator', icon: FileText, num: '04' },
      ],
    },
    {
      heading: 'Library',
      items: [
        { label: 'My Projects', path: '/projects', icon: FolderGit2 },
        { label: 'Recent Activity', path: '/activity', icon: Activity },
      ],
    },
    {
      heading: 'Preferences',
      items: [
        { label: 'Settings', path: '/settings', icon: Settings },
        { label: 'Help & Docs', path: '/help', icon: HelpCircle },
      ],
    },
  ];

  const renderSidebarBody = (isMobileDrawer: boolean) => {
    const isCollapsed = isMobileDrawer ? false : collapsed;

    return (
      <aside
        data-testid="workspace-sidebar"
        className={`h-full flex flex-col justify-between bg-[#0c0c10] border-r border-zinc-800/80 transition-all duration-200 select-none ${
          isCollapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        {/* Top Brand Header + Navigation */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="h-14 flex items-center justify-between px-3.5 border-b border-zinc-800/80">
            <Logo
              to="/dashboard"
              size="sm"
              showText={!isCollapsed}
              className={isCollapsed ? 'mx-auto' : ''}
            />

            {isMobileDrawer ? (
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/70 transition-colors cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X size={16} />
              </button>
            ) : (
              !isCollapsed && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  data-testid="sidebar-collapse-toggle"
                  className="hidden md:flex p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/70 transition-colors cursor-pointer"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <ChevronLeft size={15} />
                </button>
              )
            )}
          </div>

          {isCollapsed && !isMobileDrawer && (
            <div className="px-2 pt-2.5 flex justify-center">
              <button
                type="button"
                onClick={onToggleCollapse}
                data-testid="sidebar-collapse-toggle"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/70 transition-colors cursor-pointer"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}

          {/* Grouped Navigation */}
          <nav aria-label="Workspace Navigation" className="p-2.5 space-y-4">
            {navGroups.map((group) => (
              <div key={group.heading} className="space-y-0.5">
                {!isCollapsed && (
                  <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {group.heading}
                  </div>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={onCloseMobile}
                      title={isCollapsed ? item.label : undefined}
                      aria-label={item.label}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-violet-500/12 text-white border border-violet-500/25'
                            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-transparent'
                        } ${isCollapsed ? 'justify-center px-0' : ''}`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && !isCollapsed && (
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-violet-400"
                            />
                          )}
                          <Icon
                            size={16}
                            className={`shrink-0 ${
                              isActive ? 'text-violet-400' : 'text-zinc-400 group-hover:text-zinc-200'
                            }`}
                          />
                          {!isCollapsed && (
                            <div className="flex items-center justify-between flex-1 min-w-0">
                              <span className="truncate">{item.label}</span>
                              {'num' in item && item.num && (
                                <span className="text-[10px] font-mono text-zinc-500 shrink-0 ml-2">
                                  {item.num}
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            ))}

            {/* Interactive Guided Tour Action */}
            <div className="pt-1 border-t border-zinc-800/70">
              <button
                type="button"
                onClick={() => {
                  onCloseMobile?.();
                  startTour(0);
                }}
                data-testid="sidebar-guided-tour-button"
                title={isCollapsed ? 'Guided Tour' : undefined}
                aria-label="Guided Tour"
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-violet-300 hover:text-white bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 transition-colors cursor-pointer ${
                  isCollapsed ? 'justify-center px-0' : ''
                }`}
              >
                <Compass size={16} className="shrink-0 text-violet-400" />
                {!isCollapsed && <span className="truncate">Guided Tour</span>}
              </button>
            </div>
          </nav>
        </div>

        {/* Bottom User Profile & Logout */}
        <div className="p-2.5 border-t border-zinc-800/80 space-y-1.5">
          {currentUser && (
            <div
              className={`rounded-xl bg-[#111116] border border-zinc-800/80 flex items-center gap-2.5 ${
                isCollapsed ? 'p-1.5 justify-center' : 'px-2.5 py-2'
              }`}
              title={
                isCollapsed
                  ? `${currentUser.displayName || 'Engineer'} (${
                      currentUser.isGuest ? 'Guest Session' : currentUser.email || 'Authenticated'
                    })`
                  : undefined
              }
            >
              <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-xs font-semibold text-violet-200 shrink-0">
                {currentUser.displayName ? currentUser.displayName[0].toUpperCase() : 'E'}
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-100 truncate">
                    {currentUser.displayName || 'Engineer'}
                  </p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {currentUser.isGuest
                      ? 'Guest Session'
                      : currentUser.email || 'Authenticated'}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            data-testid="sidebar-logout-button"
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer ${
              isCollapsed ? 'justify-center px-0' : ''
            }`}
            title={isCollapsed ? 'Logout' : undefined}
            aria-label="Logout"
          >
            <LogOut size={15} className="shrink-0" />
            {!isCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    );
  };

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <div className="hidden md:block h-screen sticky top-0 shrink-0 z-30">
        {renderSidebarBody(false)}
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative flex-1 max-w-[260px] w-full bg-[#0c0c10]">
            {renderSidebarBody(true)}
          </div>
        </div>
      )}
    </>
  );
};
