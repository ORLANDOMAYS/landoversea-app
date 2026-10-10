import { Link, useLocation } from 'wouter';
import { Globe, Heart, MessageCircle, User, Compass, GraduationCap, Sparkles, Settings, ShieldAlert, Users, LayoutDashboard } from 'lucide-react';
import { User as UserType } from '@workspace/api-client-react';
import { useI18n, type TranslationKey } from '@/i18n';

export default function DesktopSidebar({ user }: { user: UserType }) {
  const [location] = useLocation();
  const { t } = useI18n();

  const isCoach = user.role === 'coach';
  const isAdmin = user.role === 'admin';

  const navItems: { href: string; icon: typeof Heart; labelKey: TranslationKey }[] = [
    { href: '/discover', icon: Heart, labelKey: 'nav.discover' },
    { href: '/matches', icon: Users, labelKey: 'nav.matches' },
    { href: '/messages', icon: MessageCircle, labelKey: 'nav.messages' },
    { href: '/cultural', icon: Globe, labelKey: 'nav.culturalPassport' },
    { href: '/learn', icon: GraduationCap, labelKey: 'nav.learn' },
    { href: '/coaches', icon: Compass, labelKey: 'nav.coaches' },
    { href: '/premium', icon: Sparkles, labelKey: 'nav.premium' },
  ];

  const bottomItems: { href: string; icon: typeof Heart; labelKey: TranslationKey }[] = [
    { href: '/profile', icon: User, labelKey: 'nav.myProfile' },
    { href: '/settings', icon: Settings, labelKey: 'nav.settings' },
    { href: '/safety', icon: ShieldAlert, labelKey: 'nav.safety' },
  ];

  if (isCoach) {
    navItems.push({ href: '/coach-dashboard', icon: LayoutDashboard, labelKey: 'nav.coachDashboard' });
  }

  if (isAdmin) {
    navItems.push({ href: '/admin', icon: ShieldAlert, labelKey: 'nav.admin' });
  }

  return (
    <div className="flex flex-col h-full py-8 px-4 overflow-y-auto">
      <Link href="/discover" className="mb-10 px-4">
        <h1 className="text-2xl font-serif font-semibold tracking-tight text-primary">
          LandOver<span className="text-accent italic">SEA</span>
        </h1>
      </Link>

      <nav className="flex-1 space-y-1">
        {navItems.map(({ href, icon: Icon, labelKey }) => {
          const isActive = location === href || location.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="pt-8 mt-8 border-t border-border space-y-1">
        {bottomItems.map(({ href, icon: Icon, labelKey }) => {
          const isActive = location === href || location.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={`flex items-center gap-4 px-4 py-2 rounded-lg transition-colors text-sm ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
              {t(labelKey)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
