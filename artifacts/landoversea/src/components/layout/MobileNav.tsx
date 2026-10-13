import { type MouseEvent, useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Compass, Heart, MessageCircle, Star, User } from 'lucide-react';
import { useGetConversations } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';

export default function MobileNav() {
  const [location] = useLocation();
  const { t } = useI18n();

  const { data: conversations } = useGetConversations({
    query: { queryKey: ['conversations'], refetchInterval: 15000 },
  });

  const unreadCount = conversations
    ? conversations.filter((c) => (c.unreadCount ?? 0) > 0).length
    : 0;

  const navItems = useMemo(() => [
    {
      href: '/discover',
      testId: 'discover',
      icon: Compass,
      label: t('nav.discover'),
      badge: 0,
      routes: ['/discover', '/filters', '/voice-intro'],
    },
    {
      href: '/matches',
      testId: 'matches',
      icon: Heart,
      label: t('nav.matches'),
      badge: 0,
      routes: ['/matches', '/who-liked-me'],
    },
    {
      href: '/messages',
      testId: 'messages',
      icon: MessageCircle,
      label: t('nav.chat'),
      badge: unreadCount,
      routes: ['/messages'],
    },
    {
      href: '/coaches',
      testId: 'coaches',
      icon: Star,
      label: t('nav.coaches'),
      badge: 0,
      routes: ['/coaches', '/coaching', '/coach-dashboard', '/client-progress'],
    },
    {
      href: '/profile',
      testId: 'profile',
      icon: User,
      label: t('nav.profile'),
      badge: 0,
      routes: [
        '/profile',
        '/edit-profile',
        '/premium',
        '/settings',
        '/verification',
        '/notifications',
      ],
    },
  ], [t, unreadCount]);

  const rawPathname = location.split(/[?#]/, 1)[0];
  const pathname = rawPathname.length > 1
    ? rawPathname.replace(/\/+$/, '')
    : rawPathname;

  const handleTabClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (pathname !== href) return;

    // A root-tab re-tap is an action, not a navigation. Preventing the Link's
    // default keeps browser history stable while resetting either scrolling
    // model used by the responsive shell.
    event.preventDefault();
    const main = document.getElementById('app-main-scroll');
    main?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  };

  return (
    <nav
      aria-label="Primary navigation"
      data-testid="mobile-bottom-navigation"
      className="flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom)]"
      style={{
        height: 'var(--mobile-nav-height)',
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid var(--nav-border)',
      }}
    >
      {navItems.map(({ href, testId, icon: Icon, label, badge, routes }) => {
        const isActive = routes.some(
          (route) => pathname === route || pathname.startsWith(`${route}/`),
        );
        return (
          <Link
            key={href}
            href={href}
            data-testid={`mobile-tab-${testId}`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
            onClick={(event) => handleTabClick(event, href)}
            className="flex flex-col items-center justify-center w-full h-full min-h-[44px] space-y-1 transition-colors relative"
            style={{ touchAction: 'manipulation' }}
          >
            {/* Active top indicator line */}
            {isActive && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded-full bg-primary"
                style={{ boxShadow: '0 0 6px rgba(255,45,122,0.7)' }}
              />
            )}
            <div className="relative">
              <Icon
                className={`w-6 h-6 transition-colors ${
                  isActive ? 'text-primary' : 'text-navigation-muted-foreground'
                }`}
                style={
                  isActive
                    ? { filter: 'drop-shadow(0 0 6px rgba(255,45,122,0.6))' }
                    : undefined
                }
                strokeWidth={isActive ? 2.5 : 2}
              />
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-brand-surface-foreground text-[9px] font-bold leading-none">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </div>
            <span
              className={`text-[10px] font-medium tracking-wide transition-colors ${
                isActive ? 'text-primary' : 'text-navigation-muted-foreground'
              }`}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
