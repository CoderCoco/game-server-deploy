import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, type EnvInfo } from '../api.js';
import {
  LayoutDashboard,
  Server,
  ScrollText,
  BarChart3,
  Bell,
  MessageSquare,
  Settings,
} from 'lucide-react';

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  disabled?: boolean;
}

const monitoringItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/servers', icon: Server, label: 'Servers', disabled: true },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
  { to: '/metrics', icon: BarChart3, label: 'Metrics', disabled: true },
  { to: '/alerts', icon: Bell, label: 'Alerts', disabled: true },
];

const configItems: NavItem[] = [
  { to: '/discord', icon: MessageSquare, label: 'Discord' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

/**
 * Navigation shell — persistent sidebar + top bar that wraps all routed pages.
 * Sidebar shows "Monitoring" and "Configuration" sections with active-route
 * highlighting (purple gradient + 2px left accent). Top bar displays env pill
 * (e.g. "PROD · us-east-1"), search placeholder, and LIVE indicator.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [env, setEnv] = useState<EnvInfo | null>(null);

  useEffect(() => {
    api.env().then(setEnv).catch(console.error);
  }, []);

  const envLabel = env
    ? `${env.environment} · ${env.region}`
    : 'local';

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
              <Server className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-foreground">Game Servers</span>
          </div>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {/* Monitoring */}
          <div>
            <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Monitoring
            </div>
            <div className="space-y-1">
              {monitoringItems.map((item) => (
                <NavLink key={item.to + item.label} item={item} active={location.pathname === item.to} />
              ))}
            </div>
          </div>

          {/* Configuration */}
          <div>
            <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Configuration
            </div>
            <div className="space-y-1">
              {configItems.map((item) => (
                <NavLink key={item.to + item.label} item={item} active={location.pathname === item.to} />
              ))}
            </div>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-foreground">Game Server Manager</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
              {envLabel}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Search placeholder */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search... ⌘K"
                className="w-64 px-3 py-1.5 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                readOnly
              />
            </div>

            {/* LIVE indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded border border-border">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs font-medium text-muted-foreground">LIVE</span>
            </div>

            {/* Avatar placeholder */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
              <span className="text-xs font-medium text-white">OP</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const className = `
    relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
    ${item.disabled
      ? 'text-muted-foreground/40 cursor-not-allowed'
      : active
        ? 'bg-gradient-to-r from-purple-500/10 to-transparent text-purple-400 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-purple-500 before:rounded-full'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }
  `;
  if (item.disabled) {
    return (
      <span className={className}>
        <Icon className="w-4 h-4" />
        {item.label}
      </span>
    );
  }
  return (
    <Link to={item.to} className={className}>
      <Icon className="w-4 h-4" />
      {item.label}
    </Link>
  );
}
