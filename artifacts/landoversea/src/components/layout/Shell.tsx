import { type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { type User } from '@workspace/api-client-react';
import MobileNav from './MobileNav';
import TopHeader from './TopHeader';
import LanguageSwitcher from './LanguageSwitcher';
import FloatingLanguageControl from './FloatingLanguageControl';
import IncomingVideoCall from '@/components/video/IncomingVideoCall';

const PUBLIC_PATHS = ['/login', '/register', '/onboarding', '/terms', '/privacy', '/forgot-password', '/reset-password', '/delete-account'];

interface ShellProps {
  children: ReactNode;
  user?: User;
}

export default function Shell({ children, user }: ShellProps) {
  const [location] = useLocation();
  const isAuthPage = PUBLIC_PATHS.some((p) => location === p || location.startsWith(p + '/'));
  const showFloatingLanguageControl = location !== '/register';
  const isImmersiveVideoCall = location.startsWith('/video-call/');

  // AuthGuard owns the request and only passes a user for authenticated
  // protected routes. Public/auth pages have no protected chrome, but they
  // still get a language selector so visitors can switch before signing in.
  if (isAuthPage || !user) {
    return (
      <>
        {/* Desktop language selector for auth / public pages */}
        <div className="hidden md:flex fixed top-4 right-4 z-50">
          <LanguageSwitcher />
        </div>
        {children}
        {/* Registration begins with language selection, so its form does not
            need a second floating control competing with narrow inputs. */}
        {showFloatingLanguageControl && (
          <FloatingLanguageControl navReserved={location === '/onboarding'} />
        )}
      </>
    );
  }

  if (isImmersiveVideoCall) {
    return <>{children}</>;
  }

  // ── Authenticated: render full shell ─────────────────────────────────────
  return (
    <div className="flex flex-col min-h-[100dvh]">
      <IncomingVideoCall />

      {/* Desktop top header */}
      <div className="hidden md:block">
        <TopHeader user={user} />
      </div>

      {/* Main content — reserve exactly the mobile-nav height + safe area on
          mobile, and nothing on desktop. */}
      <main
        id="app-main-scroll"
        data-testid="app-main-scroll"
        className="flex-1 overflow-y-auto pb-[var(--mobile-nav-space)] md:pb-0"
      >
        {children}
      </main>

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50">
        <MobileNav />
      </div>

      {/* Keep the control above either the mobile nav or the chat composer. */}
      <FloatingLanguageControl navReserved />
    </div>
  );
}
