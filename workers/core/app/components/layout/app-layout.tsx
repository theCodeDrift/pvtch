import { useState } from 'react';
import { Link, Outlet, useLocation, useLoaderData, data } from 'react-router';
import type { Route } from './+types/app-layout';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Github,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { TwitchLogin } from '@/components/twitch-login';
import { PvtchLogo } from '@/components/icons/pvtch-logo';
import { cn } from '@/lib/utils';
import { authMiddleware } from '@/middleware/auth';
import {
  cloudflareEnvironmentContext,
  instanceAccessContext,
  userContext,
} from '@/context';
import { canUseLingual } from '@/lib/lingual';

export const middleware: Route.MiddlewareFunction[] = [authMiddleware];

export function loader({ context }: Route.LoaderArgs) {
  const access = context.get(instanceAccessContext);
  const user = context.get(userContext);
  const env = context.get(cloudflareEnvironmentContext);
  return data({
    isPrivate: access?.isPrivate ?? false,
    isAllowed: access?.isAllowed ?? true,
    // Bots is in preview: only LINGUAL_PREVIEW_USERS see the section.
    showBots: canUseLingual(env, user?.login),
  });
}

// Navigation structure
const navigation = [
  {
    title: 'Widgets',
    items: [
      { title: 'Board', href: '/board' },
      { title: 'Coworking Tasks', href: '/widgets/todo' },
      { title: 'Progress Bar', href: '/widgets/progress' },
      { title: 'Quick Poll', href: '/widgets/1s' },
    ],
  },
  {
    title: 'Helpers',
    items: [{ title: 'Lingo', href: '/helpers/lingo' }],
  },
  {
    title: 'Bots',
    preview: true,
    items: [{ title: 'Lingual', href: '/bots/lingual' }],
  },
  {
    title: 'Support PVTCH',
    items: [
      {
        title: 'Host Your Own',
        href: '/howto/deploy-your-own',
      },
      {
        title: 'GitHub',
        href: 'https://github.com/thecodedrift/pvtch',
        external: true,
      },
      {
        title: 'Donate',
        href: 'https://ko-fi.com/theCodeDrift',
        external: true,
      },
    ],
  },
];

function NavSection({
  title,
  items,
  currentPath,
}: {
  title: string;
  items: Array<{ title: string; href: string; external?: boolean }>;
  currentPath: string;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        {title}
        {isOpen ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
      </button>
      {isOpen && (
        <ul className="mt-1 space-y-1">
          {items.map((item) => (
            <li key={item.href}>
              {item.external ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {item.title}
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                <Link
                  to={item.href}
                  className={cn(
                    'block rounded-md px-3 py-2 text-sm',
                    currentPath === item.href
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {item.title}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="size-9"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const loaderData = useLoaderData<typeof loader>();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center px-4 md:px-6">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="mr-2 md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
            <span className="sr-only">Toggle menu</span>
          </Button>

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-bold text-xl">
            <PvtchLogo className="size-8 text-brand" />
            <span className="text-primary">PVTCH</span>
          </Link>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side actions */}
          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/thecodedrift/pvtch"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:block"
            >
              <Button variant="ghost" size="icon" className="size-9">
                <Github className="size-4" />
                <span className="sr-only">GitHub</span>
              </Button>
            </a>
            <ThemeToggle />
            <TwitchLogin
              isPrivate={loaderData.isPrivate}
              isAllowed={loaderData.isAllowed}
            />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <aside
          className={cn(
            'fixed left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-border bg-background transition-transform md:sticky md:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <nav className="h-full overflow-y-auto p-4">
            {navigation
              .filter((section) => loaderData.showBots || !section.preview)
              .map((section) => (
                <NavSection
                  key={section.title}
                  title={section.title}
                  items={section.items}
                  currentPath={location.pathname}
                />
              ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
