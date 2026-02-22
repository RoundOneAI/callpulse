import { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Phone,
  Upload,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Activity,
  Trophy,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { useAuthStore } from '../store/auth';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Upload Calls', href: '/upload', icon: Upload },
  { name: 'All Calls', href: '/calls', icon: Phone },
  { name: 'Team', href: '/team', icon: Users },
  { name: 'Weekly Reports', href: '/reports', icon: BarChart3 },
  { name: 'WoW Comparison', href: '/comparison', icon: Activity },
  { name: 'Leaderboard', href: '/leaderboard', icon: Trophy },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, company, signOut } = useAuthStore();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="fixed inset-0 bg-gray-600/75"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-xl">
            <SidebarContent
              currentPath={location.pathname}
              company={company}
              user={user}
              onSignOut={signOut}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col">
        <div className="flex grow flex-col bg-white border-r border-gray-200">
          <SidebarContent
            currentPath={location.pathname}
            company={company}
            user={user}
            onSignOut={signOut}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-500 hover:text-gray-700"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-gray-900">CallPulse</span>
          </div>
        </div>

        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  currentPath,
  company,
  user,
  onSignOut,
  onClose,
}: {
  currentPath: string;
  company: { name: string } | null;
  user: { full_name: string; role: string } | null;
  onSignOut: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-indigo-600" />
          <span className="text-lg font-bold text-gray-900">CallPulse</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-gray-400">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {company && (
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-900">{company.name}</p>
          <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = currentPath === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <item.icon className={cn('h-5 w-5', isActive ? 'text-indigo-600' : 'text-gray-400')} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center">
            <span className="text-sm font-medium text-indigo-700">
              {user?.full_name?.charAt(0) || '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.full_name}</p>
          </div>
          <button
            onClick={onSignOut}
            className="text-gray-400 hover:text-gray-600"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
