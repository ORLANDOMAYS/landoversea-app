import { useRoute, useLocation } from 'wouter';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  Loader2, ChevronLeft, MapPin, ShieldCheck, Globe, Anchor,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { useLiveProfile } from '@/hooks/use-supabase-surfaces';

export default function ProfileDetails() {
  const { t } = useI18n();
  const [, params] = useRoute('/profile/:userId');
  const [, setLocation] = useLocation();

  const userId = params?.userId ?? '';
  const validId = /^[0-9a-f-]{36}$/i.test(userId);

  const { data: profile, isLoading, isError } = useLiveProfile(validId ? userId : undefined);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!validId || isError || !profile) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="w-20 h-20 rounded-full glass border border-white/15 flex items-center justify-center">
          <Anchor className="w-10 h-10 text-primary" />
        </div>
        <h2 className="font-serif text-2xl text-foreground">{t('profile.notFound')}</h2>
        <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">{t('profile.notFoundDesc')}</p>
        <button
          type="button"
          data-testid="button-back"
          onClick={() => setLocation('/discover')}
          className="btn-glow px-6 py-3 text-white font-semibold rounded-full"
        >
          {t('common.back')}
        </button>
      </div>
    );
  }

  const photo =
    resolveMediaUrl(
      profile.photos?.find((p) => p.isPrimary)?.url ||
      profile.photos?.[0]?.url,
    ) ||
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=400';

  const languages = profile.otherLanguages ?? [];
  const interests = [
    ...(profile.culturalInterests ?? []),
    ...(profile.interests ?? []),
  ];

  return (
    <div className="min-h-[100dvh] pb-32 relative" data-testid={`page-profile-${profile.userId}`}>
      {/* Back button */}
      <div className="flex items-center px-4 pt-[env(safe-area-inset-top)] pt-6 pb-2">
        <button
          type="button"
          data-testid="button-back"
          onClick={() => window.history.length > 1 ? window.history.back() : setLocation('/discover')}
          className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
      </div>

      {/* Cover photo */}
      <div className="relative w-full" style={{ aspectRatio: '4/3', maxHeight: '320px', overflow: 'hidden' }}>
        <img src={photo} alt={profile.name} className="object-cover w-full h-full" data-testid="img-profile-photo" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>

      {/* Info */}
      <div className="px-4 -mt-16 relative z-10">
        <h2 className="font-serif text-foreground text-2xl font-bold" data-testid="text-profile-name">
          {profile.name}{profile.age ? `, ${profile.age}` : ''}
        </h2>

        {(profile.city || profile.country) && (
          <div className="flex items-center gap-1 mt-1">
            <MapPin size={14} className="text-muted-foreground" />
            <span className="text-muted-foreground text-sm" data-testid="text-profile-location">
              {profile.city ? `${profile.city}, ` : ''}{profile.country}
            </span>
          </div>
        )}

        {profile.isVerified && (
          <div className="glass inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-cyan-400 border border-cyan-400/30 mt-2">
            <ShieldCheck size={12} />
            {t('profile.verified')}
          </div>
        )}

        {/* Languages */}
        {(profile.primaryLanguage || languages.length > 0) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {profile.primaryLanguage && (
              <span className="glass px-3 py-1 rounded-full text-xs text-foreground border border-border inline-flex items-center gap-1">
                <Globe size={12} /> {profile.primaryLanguage}
              </span>
            )}
            {languages
              .filter((lang) => lang !== profile.primaryLanguage)
              .map((lang) => (
                <span key={lang} className="glass px-3 py-1 rounded-full text-xs text-muted-foreground border border-border">
                  {lang}
                </span>
              ))}
          </div>
        )}

        {/* Bio */}
        {profile.bio && (
          <div className="mt-4">
            <h3 className="text-foreground text-sm font-medium mb-1">{t('profile.about')}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed" data-testid="text-profile-bio">{profile.bio}</p>
          </div>
        )}

        {/* Interests */}
        {interests.length > 0 && (
          <div className="mt-5">
            <h3 className="text-foreground text-sm font-medium mb-2">{t('profile.interests')}</h3>
            <div className="flex flex-wrap gap-2">
              {interests.map((item) => (
                <span
                  key={item}
                  className="glass px-3 py-1.5 rounded-full text-xs text-muted-foreground border border-border"
                  data-testid={`chip-interest-${item}`}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
