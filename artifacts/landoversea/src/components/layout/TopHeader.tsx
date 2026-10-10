import { Link, useLocation } from 'wouter';
import { Bell } from 'lucide-react';
import { User as UserType, useGetUnreadCount } from '@workspace/api-client-react';
import { useI18n, type TranslationKey } from '@/i18n';
import LanguageSwitcher from './LanguageSwitcher';
import BrandLogo from '@/components/brand/BrandLogo';

interface TopHeaderProps {
  user: UserType;
}

const NAV_LINKS: { href: string; labelKey: TranslationKey }[] = [
  { href: '/discover', labelKey: 'nav.discover' },
  { href: '/matches', labelKey: 'nav.matches' },
  { href: '/messages', labelKey: 'nav.chat' },
  { href: '/cultural', labelKey: 'nav.passport' },
  { href: '/events', labelKey: 'nav.events' },
  { href: '/coaches', labelKey: 'nav.coaches' },
  { href: '/premium', labelKey: 'nav.premium' },
  { href: '/profile', labelKey: 'nav.profile' },
];

export default function TopHeader({ user: _user }: TopHeaderProps) {
  const [location] = useLocation();
  const { t } = useI18n();

  const { data: unreadData } = useGetUnreadCount({
    query: { queryKey: ['unreadCount'], refetchInterval: 30000 },
  });

  const notificationCount = unreadData?.notifications ?? 0;

  return (
    <header
      className="h-16 sticky top-0 z-50 flex items-center px-6 gap-4"
      style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--nav-border)',
      }}
    >
      {/* LEFT: Brand */}
      <Link href="/discover" className="flex-shrink-0 select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
        <BrandLogo className="h-10 w-36" />
      </Link>

      {/* CENTER: Nav links */}
      <nav className="flex-1 flex items-center justify-center gap-1 overflow-x-auto">
        {NAV_LINKS.map(({ href, labelKey }) => {
          const isActive = location === href || location.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`text-sm px-3 py-1 rounded-full transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-primary font-medium'
                  : 'text-navigation-muted-foreground hover:text-navigation-foreground'
              }`}
            >
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>

      {/* RIGHT: Language switcher + Notifications */}
      <div className="flex-shrink-0 flex items-center gap-3">
        <LanguageSwitcher />
        <Link href="/notifications" className="relative text-navigation-muted-foreground hover:text-navigation-foreground transition-colors">
          <Bell className="w-5 h-5" />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
          )}
        </Link>
      </div>
    </header>
  );
}
