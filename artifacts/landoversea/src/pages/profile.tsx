import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  useGetMatchStats,
} from '@workspace/api-client-react';
import {
  Loader2, Settings, ShieldCheck, Camera, LogOut, Edit2,
  MapPin, Sparkles, SlidersHorizontal, Bell, Eye, BookOpen,
  ChevronRight, X,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import LanguageSwitcher from '@/components/layout/LanguageSwitcher';
import { getSupabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/auth';
import { useLiveProfile, useLiveUpdateProfile } from '@/hooks/use-supabase-surfaces';

export default function Profile() {
  const { t } = useI18n();
  const { data: profile, isLoading } = useLiveProfile();
  const { data: matchStats } = useGetMatchStats({ query: { queryKey: ['matchStats'] } });
  const updateProfileMutation = useLiveUpdateProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [isEditing, setIsEditing] = useState(false);
  const [bio, setBio] = useState('');
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[100dvh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) return null;

  const photo = resolveMediaUrl(profile.photos?.[0]?.url) || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=400';

  const handleSaveBio = () => {
    updateProfileMutation.mutate({ data: { bio } }, {
      onSuccess: () => {
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
        toast({ title: t('profile.bioUpdated') });
      }
    });
  };

  const handleLogout = async () => {
    setLogoutPending(true);
    const { error } = await getSupabase().auth.signOut();
    if (error) {
      setLogoutPending(false);
      toast({ title: t('auth.logout'), description: error.message, variant: 'destructive' });
      return;
    }
    queryClient.clear();
    window.location.href = `${import.meta.env.BASE_URL}login`;
  };

  const closeDeleteSheet = () => {
    setShowDeleteSheet(false);
    setDeletePassword('');
    setDeleteError(null);
  };

  const handleDeleteAccount = async () => {
    // The delete-account endpoint requires the account password as
    // `confirmPassword`. Send it via a direct request so the real input
    // contract is honored (the generated hook carries no body).
    const password = deletePassword;
    if (!password) {
      setDeleteError(t('profile.deletePasswordRequired'));
      return;
    }

    setDeletePending(true);
    setDeleteError(null);
    try {
      const resp = await authenticatedFetch(import.meta.env.BASE_URL + 'api/auth/delete-account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirmPassword: password }),
      });

      if (resp.ok) {
        // Success: clear all cached/session state, then hard-navigate to login
        // with an explicit success signal so no stale query survives the SPA.
        queryClient.clear();
        setDeletePassword('');
        setShowDeleteSheet(false);
        window.location.href =
          import.meta.env.BASE_URL + 'login?deleted=1';
        return;
      }

      // Map precise, actionable errors; the sheet stays open on failure.
      if (resp.status === 401) {
        setDeleteError(t('profile.deleteWrongPassword'));
      } else if (resp.status === 400) {
        setDeleteError(t('profile.deletePasswordRequired'));
      } else if (resp.status === 404) {
        // Account already gone from another session: treat as done.
        queryClient.clear();
        window.location.href = import.meta.env.BASE_URL + 'login?deleted=1';
        return;
      } else {
        setDeleteError(t('profile.deleteUnavailable'));
      }
    } catch {
      setDeleteError(t('profile.deleteUnavailable'));
    } finally {
      setDeletePending(false);
    }
  };

  const menuRows = [
    {
      icon: <Sparkles size={22} className="text-primary" />,
      label: t('profile.premium'),
      href: '/premium',
      badge: (profile as any).isPremium ? (
        <span className="text-xs text-cyan-400 glass px-2 py-0.5 rounded-full border border-cyan-400/30">{t('profile.active')}</span>
      ) : null,
    },
    {
      icon: <ShieldCheck size={22} className="text-cyan-400" />,
      label: t('profile.verification'),
      href: '/verification',
    },
    {
      icon: <SlidersHorizontal size={22} className="text-secondary" />,
      label: t('profile.discoveryFilters'),
      href: '/discover',
    },
    {
      icon: <Bell size={22} className="text-foreground" />,
      label: t('nav.notifications'),
      href: '/notifications',
    },
    {
      icon: <Eye size={22} className="text-foreground" />,
      label: t('profile.privacy'),
      href: '/privacy',
    },
    {
      icon: <BookOpen size={22} className="text-foreground" />,
      label: t('profile.tutorial'),
      href: null,
      onClick: () => toast({ title: t('common.comingSoon') }),
    },
    {
      icon: <Settings size={22} className="text-foreground" />,
      label: t('nav.settings'),
      href: '/settings',
    },
  ];

  return (
    <div className="min-h-[100dvh] pb-32 relative">

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] pt-6 pb-4">
        <h1 className="font-serif text-foreground text-2xl">{t('profile.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="glass rounded-full flex items-center justify-center">
            <LanguageSwitcher variant="compact" />
          </div>
          <Link href="/settings">
            <div className="w-10 h-10 rounded-full glass flex items-center justify-center text-foreground hover:text-foreground transition-colors">
              <Settings size={18} />
            </div>
          </Link>
        </div>
      </div>

      {/* Cover photo */}
      <div className="relative w-full" style={{ aspectRatio: '4/3', maxHeight: '260px', overflow: 'hidden' }}>
        <img src={photo} alt={profile.name} className="object-cover w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080014]/80 to-transparent" />
        <button
          type="button"
          aria-label={t('profile.editProfile')}
          onClick={() => setLocation('/edit-profile')}
          className="btn-glow absolute bottom-3 right-3 z-20 w-11 h-11 rounded-full flex items-center justify-center pointer-events-auto"
        >
          <Camera size={18} className="text-brand-surface-foreground" />
        </button>
      </div>

      {/* Profile info */}
      <div className="px-4 -mt-16 relative z-10">
        {/* Name + age */}
        <h2 className="font-serif text-foreground text-2xl font-bold">
          {profile.name}{profile.age ? `, ${profile.age}` : ''}
        </h2>

        {/* Location */}
        {(profile.city || profile.country) && (
          <div className="flex items-center gap-1 mt-1">
            <MapPin size={14} className="text-muted-foreground" />
            <span className="text-muted-foreground text-sm">
              {profile.city ? `${profile.city}, ` : ''}{profile.country}
            </span>
          </div>
        )}

        {/* Verified pill */}
        {profile.isVerified && (
          <div className="glass inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-cyan-400 border border-cyan-400/30 mt-2">
            <ShieldCheck size={12} />
            {t('profile.verified')}
          </div>
        )}

        {/* Language badges */}
        {((profile as any).languages?.length > 0 || profile.primaryLanguage) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {profile.primaryLanguage && (
              <span className="glass px-3 py-1 rounded-full text-xs text-foreground border border-border">
                🌐 {profile.primaryLanguage}
              </span>
            )}
            {((profile as any).languages || []).map((lang: string) => (
              lang !== profile.primaryLanguage && (
                <span key={lang} className="glass px-3 py-1 rounded-full text-xs text-foreground border border-border">
                  {lang}
                </span>
              )
            ))}
          </div>
        )}

        {/* Bio */}
        <div className="mt-4">
          {isEditing ? (
            <div>
              <textarea
                className="glass-input rounded-xl p-3 text-sm text-foreground w-full min-h-[100px] focus:outline-none resize-none"
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder={t('profile.bioPlaceholder')}
              />
              <div className="flex gap-2 mt-2">
                <button
                  className="text-muted-foreground text-sm px-4 py-1.5 rounded-full glass hover:text-foreground transition-colors"
                  onClick={() => setIsEditing(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="btn-glow px-4 py-1.5 rounded-full text-sm"
                  onClick={handleSaveBio}
                  disabled={updateProfileMutation.isPending}
                >
                  {updateProfileMutation.isPending ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <p className="text-foreground text-sm leading-relaxed flex-1">
                {profile.bio || t('profile.addBio')}
              </p>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
                onClick={() => { setBio(profile.bio || ''); setIsEditing(true); }}
              >
                <Edit2 size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-primary">{matchStats?.totalMatches ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('profile.matches')}</p>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-accent">{(profile as any).profileViews ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('profile.profileViews')}</p>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-secondary">{(profile as any).superlikeBalance ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('profile.likes')}</p>
          </div>
        </div>

        {/* Two primary action buttons */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link href="/edit-profile">
            <div className="glass border border-border rounded-2xl py-3 text-center text-foreground font-medium cursor-pointer hover:glass-strong transition-all">
              {t('profile.editProfile')}
            </div>
          </Link>
          <Link href="/matches">
            <div className="btn-glow rounded-2xl py-3 text-center text-white font-semibold cursor-pointer">
              {t('profile.myMatches')}
            </div>
          </Link>
        </div>

        {/* Menu rows */}
        <div className="mt-6 space-y-2">
          {menuRows.map((row) => {
            const inner = (
              <div className="glass rounded-2xl px-4 py-4 flex items-center gap-3 cursor-pointer hover:glass-strong transition-all">
                {row.icon}
                <span className="text-foreground font-medium text-sm flex-1">{row.label}</span>
                {row.badge}
                <ChevronRight size={18} className="text-muted-foreground ml-auto" />
              </div>
            );
            if (row.href) {
              return <Link key={row.label} href={row.href}>{inner}</Link>;
            }
            return (
              <div key={row.label} onClick={row.onClick}>
                {inner}
              </div>
            );
          })}
        </div>

        {/* Logout */}
        <div className="mt-8">
          {confirmingLogout ? (
            <div className="glass rounded-2xl p-4 text-center space-y-3">
              <p className="text-foreground text-sm">{t('auth.logoutConfirm')}</p>
              <div className="flex gap-3">
                <button
                  className="flex-1 glass rounded-full py-2 text-foreground text-sm hover:text-foreground transition-colors"
                  onClick={() => setConfirmingLogout(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="flex-1 rounded-full py-2 text-sm font-semibold text-red-400 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                  onClick={handleLogout}
                  disabled={logoutPending}
                >
                  {logoutPending ? t('auth.loggingOut') : t('auth.logout')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full glass rounded-2xl px-4 py-4 flex items-center justify-center gap-2 text-red-400 hover:text-red-300 transition-colors"
              onClick={() => setConfirmingLogout(true)}
            >
              <LogOut size={18} />
              <span className="font-medium">{t('auth.logout')}</span>
            </button>
          )}
        </div>

        {/* Delete account */}
        <div className="mt-3 text-center">
          <button
            data-testid="button-open-delete-account"
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
            onClick={() => { setDeletePassword(''); setDeleteError(null); setShowDeleteSheet(true); }}
          >
            {t('profile.deleteAccount')}
          </button>
        </div>
      </div>

      {/* Delete account bottom sheet */}
      {showDeleteSheet && (
        <div className="fixed inset-0 z-50 flex items-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={deletePending ? undefined : closeDeleteSheet}
          />
          {/* Sheet */}
          <div
            className="relative w-full glass-strong rounded-t-3xl px-6 pt-6 pb-12 space-y-4 max-w-[500px] mx-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 id="delete-account-title" className="font-serif text-red-400 text-xl font-bold">{t('profile.deleteAccount')}</h3>
              <button
                type="button"
                className="w-8 h-8 rounded-full glass flex items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={closeDeleteSheet}
                disabled={deletePending}
                aria-label={t('common.cancel')}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {t('profile.deleteWarning')}
            </p>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleDeleteAccount();
              }}
            >
              <div className="space-y-1 pt-1">
                <label className="text-foreground text-xs" htmlFor="delete-confirm-password">
                  {t('profile.deletePasswordLabel')}
                </label>
                <input
                  id="delete-confirm-password"
                  type="password"
                  autoComplete="current-password"
                  data-testid="input-delete-password"
                  value={deletePassword}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(null); }}
                  placeholder={t('profile.deletePasswordPlaceholder')}
                  className="glass-input w-full rounded-xl p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-red-400/50 transition-colors"
                  disabled={deletePending}
                />
                {deleteError && (
                  <p className="text-red-400 text-xs pt-1" data-testid="text-delete-error">{deleteError}</p>
                )}
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="submit"
                  className="w-full py-3 rounded-2xl text-foreground font-semibold bg-red-500/80 hover:bg-red-500 transition-colors border border-red-400/30 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  disabled={deletePending}
                  data-testid="button-confirm-delete"
                >
                  {deletePending ? t('profile.deleting') : t('profile.deleteConfirm')}
                </button>
                <button
                  type="button"
                  className="w-full py-3 rounded-2xl text-muted-foreground font-medium glass hover:text-foreground transition-colors disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                  onClick={closeDeleteSheet}
                  disabled={deletePending}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
