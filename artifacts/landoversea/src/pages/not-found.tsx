import { Anchor } from 'lucide-react';
import { Link } from 'wouter';
import { useI18n } from '@/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-4">
      {/* Glass circle with anchor */}
      <div className="w-24 h-24 rounded-full glass border border-border flex items-center justify-center glow-pink">
        <Anchor className="w-12 h-12 text-primary" />
      </div>

      {/* 404 wordmark */}
      <h1
        className="font-script text-6xl bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"
      >
        404
      </h1>

      {/* Lost at SEA heading */}
      <h2 className="font-serif text-2xl text-foreground">{t('notFound.heading')}</h2>

      {/* Description */}
      <p className="text-muted-foreground text-center max-w-xs text-sm leading-relaxed">
        {t('notFound.description')}
      </p>

      {/* CTA */}
      <Link href="/discover" className="btn-glow px-6 py-3 text-white font-semibold rounded-full inline-block">
        {t('notFound.returnHome')}
      </Link>
    </div>
  );
}
