import { useState } from 'react';
import {
  getGetNotificationPreferencesQueryKey,
  useChangePassword,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { ChevronLeft, Eye, EyeOff, Loader2, ShieldCheck, UserX, Lock, Eye as EyeIcon, MapPin, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n, type TranslationKey } from '@/i18n';
import { getSupabase } from '@/lib/supabase';
import {
  useLiveAddLocation,
  useLiveLocations,
  useLiveRemoveLocation,
} from '@/hooks/use-supabase-surfaces';

function Switch({
  checked,
  label,
  pending,
  onChange,
}: {
  checked: boolean;
  label: string;
  pending: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending}
      disabled={pending}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const changePwdMutation = useChangePassword();
  const [logoutPending, setLogoutPending] = useState(false);
  const preferencesQuery = useGetNotificationPreferences();
  const updatePreferencesMutation = useUpdateNotificationPreferences();

  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '' });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [locationDraft, setLocationDraft] = useState({ city: '', country: '' });
  const locationsQuery = useLiveLocations();
  const addLocationMutation = useLiveAddLocation();
  const removeLocationMutation = useLiveRemoveLocation();

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    changePwdMutation.mutate(
      { data: { currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword } },
      {
        onSuccess: () => {
          toast({ title: t('settings.passwordUpdated') });
          setPwdForm({ currentPassword: '', newPassword: '' });
        },
        onError: (err: any) => {
          toast({ title: t('settings.passwordUpdateError'), description: err.message, variant: 'destructive' });
        },
      }
    );
  };

  const handleLogout = async () => {
    setLogoutPending(true);
    const { error } = await getSupabase().auth.signOut();
    if (error) {
      setLogoutPending(false);
      toast({ title: t('settings.logoutError'), description: error.message, variant: 'destructive' });
      return;
    }
    queryClient.clear();
    setLocation('/login');
  };

  const togglePref = (key: 'pushEnabled' | 'emailEnabled' | 'bookingEnabled' | 'readReceipts') => {
    const previous = preferencesQuery.data;
    if (!previous || updatePreferencesMutation.isPending) return;

    const next = {
      ...previous,
      [key]: !previous[key],
    };
    const queryKey = getGetNotificationPreferencesQueryKey();

    queryClient.setQueryData(queryKey, next);
    updatePreferencesMutation.mutate(
      { data: next },
      {
        onSuccess: updated => {
          queryClient.setQueryData(queryKey, updated);
        },
        onError: (err: any) => {
          queryClient.setQueryData(queryKey, previous);
          toast({
            title: 'Could not save preferences',
            description: err.message,
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <Link href="/profile" aria-label={t('settings.backToProfile')} className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </Link>
        <h1 className="font-serif text-xl text-foreground">{t('settings.title')}</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Change Password */}
        <div className="glass rounded-2xl p-5 space-y-4">
          <h2 className="font-serif text-lg text-foreground">{t('settings.changePassword')}</h2>
          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div className="space-y-1">
              <label className="text-foreground text-sm">{t('settings.currentPassword')}</label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={pwdForm.currentPassword}
                  onChange={e => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
                  required
                  className="glass-input w-full rounded-2xl px-4 py-2.5 pr-10 outline-none focus:border-border"
                  placeholder={t('settings.currentPasswordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-sm">{t('settings.newPassword')}</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={pwdForm.newPassword}
                  onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
                  required
                  minLength={8}
                  className="glass-input w-full rounded-2xl px-4 py-2.5 pr-10 outline-none focus:border-border"
                  placeholder={t('settings.newPasswordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={changePwdMutation.isPending}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center justify-center gap-2"
            >
              {changePwdMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('settings.updatePassword')}
            </button>
          </form>
        </div>

        {/* Preferences */}
        <div className="glass rounded-2xl p-5 space-y-1">
          <div className="flex items-center mb-3">
            <h2 className="font-serif text-lg text-foreground">{t('settings.preferences')}</h2>
          </div>
          {preferencesQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground" role="status">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          ) : preferencesQuery.isError || !preferencesQuery.data ? (
            <div className="py-5 text-center" role="alert">
              <p className="text-sm text-red-300">Unable to load preferences.</p>
              <button
                type="button"
                onClick={() => preferencesQuery.refetch()}
                className="mt-3 glass px-4 py-2 rounded-full text-sm text-foreground hover:bg-muted transition-colors"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            ([
              { key: 'pushEnabled', label: t('settings.pushNotifications') },
              { key: 'emailEnabled', label: t('settings.emailNotifications') },
              { key: 'bookingEnabled', label: `${t('nav.coaching')} · ${t('nav.notifications')}` },
              { key: 'readReceipts', label: t('settings.readReceipts') },
            ] as const).map(({ key, label }) => {
              return (
                <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                  <span className="text-foreground">{label}</span>
                  <Switch
                    checked={preferencesQuery.data[key]}
                    label={label}
                    pending={updatePreferencesMutation.isPending}
                    onChange={() => togglePref(key)}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Premium saved locations */}
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            <h2 className="font-serif text-lg text-foreground">Saved locations</h2>
          </div>
          {locationsQuery.isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>
          ) : locationsQuery.isError ? (
            <div role="alert" className="text-sm text-red-300">
              Unable to load saved locations.
              <button type="button" onClick={() => locationsQuery.refetch()} className="ms-2 underline">{t('common.retry')}</button>
            </div>
          ) : (
            <div className="space-y-2">
              {locationsQuery.data?.map((location) => (
                <div key={location.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <span className="flex-1 text-sm text-foreground">
                    {[location.city, location.country].filter(Boolean).join(', ')}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove saved location"
                    disabled={removeLocationMutation.isPending}
                    onClick={() => removeLocationMutation.mutate({ id: location.id })}
                    className="text-red-400 p-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {locationsQuery.data?.length === 0 && <p className="text-sm text-muted-foreground">No saved locations.</p>}
            </div>
          )}
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!locationDraft.city.trim() || !locationDraft.country.trim()) return;
              addLocationMutation.mutate(
                { city: locationDraft.city.trim(), country: locationDraft.country.trim() },
                { onSuccess: () => setLocationDraft({ city: '', country: '' }) },
              );
            }}
          >
            <input
              value={locationDraft.city}
              onChange={(event) => setLocationDraft((draft) => ({ ...draft, city: event.target.value }))}
              placeholder="City"
              className="glass-input rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={locationDraft.country}
              onChange={(event) => setLocationDraft((draft) => ({ ...draft, country: event.target.value }))}
              placeholder="Country"
              className="glass-input rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={addLocationMutation.isPending || !locationDraft.city.trim() || !locationDraft.country.trim()}
              className="btn-glow col-span-2 rounded-full py-2 text-sm disabled:opacity-50"
            >
              {addLocationMutation.isPending ? 'Saving…' : 'Add location'}
            </button>
          </form>
        </div>

        {/* Account Management */}
        <div className="glass rounded-2xl p-5 space-y-1">
          <h2 className="font-serif text-lg text-foreground mb-3">{t('settings.accountManagement')}</h2>
          {([
            { icon: ShieldCheck, labelKey: 'settings.verification', href: '/verification' },
            { icon: UserX, labelKey: 'settings.safetyCenter', href: '/safety' },
            { icon: Lock, labelKey: 'settings.privacySettings', href: '/privacy' },
            { icon: EyeIcon, labelKey: 'settings.profileVisibility', href: '/privacy' },
          ] as { icon: typeof ShieldCheck; labelKey: TranslationKey; href: string }[]).map(({ icon: Icon, labelKey, href }) => (
            <Link
              key={labelKey}
              href={href}
              className="w-full flex items-center gap-3 py-3 border-b border-white/5 last:border-0 hover:bg-muted transition-colors rounded-xl px-1 -mx-1"
            >
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground flex-1 text-left">{t(labelKey)}</span>
              <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </Link>
          ))}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={logoutPending}
          className="w-full glass border border-red-500/40 text-red-400 rounded-2xl py-3 font-semibold hover:bg-red-500/10 transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
        >
          {logoutPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('settings.logOut')}
        </button>

        {/* Version */}
        <p className="text-center text-muted-foreground text-xs pb-2">{t('settings.version')}</p>
      </div>
    </div>
  );
}
