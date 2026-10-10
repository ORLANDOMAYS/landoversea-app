import { useState } from 'react';
import { useRequestAccountDeletion } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ShieldAlert, Trash2, Mail, CheckCircle2, ArrowRight } from 'lucide-react';
import { useI18n } from '@/i18n';

export default function DeleteAccount() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestDeletion = useRequestAccountDeletion();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setFailed(false);

    requestDeletion.mutate(
      { data: { email } },
      {
        onSuccess: () => {
          setSubmitted(true);
        },
        onError: () => {
          setFailed(true);
        }
      }
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col pt-12 pb-24 px-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <ShieldAlert className="text-red-400 w-8 h-8" />
        <h1 className="font-serif text-3xl font-bold text-foreground">{t('deleteAccount.title')}</h1>
      </div>

      <div className="space-y-8">
        <section className="glass rounded-2xl p-6">
          <h2 className="text-xl font-bold text-foreground mb-3">{t('deleteAccount.whatHappens')}</h2>
          <p className="text-foreground mb-4 leading-relaxed">
            {t('deleteAccount.permanent')}
          </p>
          <p className="text-foreground mb-2 leading-relaxed"><strong>{t('deleteAccount.retainedIntro')}</strong></p>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-foreground">
            <li>{t('deleteAccount.retainedMessages')}</li>
            <li>{t('deleteAccount.retainedBookings')}</li>
            <li>{t('deleteAccount.retainedCredentials')}</li>
          </ul>
        </section>

        <section className="glass rounded-2xl p-6 border-red-500/20">
          <h2 className="text-xl font-bold text-foreground mb-3 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" /> {t('deleteAccount.inAppTitle')}
          </h2>
          <p className="text-foreground mb-4 leading-relaxed">
            {t('deleteAccount.inAppBody')}
          </p>
          <Link href="/profile">
            <div className="btn-glow px-6 py-3 rounded-full text-center font-semibold inline-block cursor-pointer">
              {t('deleteAccount.goToProfile')}
            </div>
          </Link>
        </section>

        <section className="glass rounded-2xl p-6">
          <h2 className="text-xl font-bold text-foreground mb-3 flex items-center gap-2">
            <Mail className="w-5 h-5 text-accent" /> {t('deleteAccount.publicTitle')}
          </h2>
          <p className="text-foreground mb-4 leading-relaxed">
            {t('deleteAccount.publicBody')}
          </p>
          
          {submitted ? (
            <div className="glass-strong border border-green-500/30 rounded-xl p-5 flex items-start gap-4" role="status" aria-live="polite">
              <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-green-400 font-bold mb-1">{t('deleteAccount.receivedTitle')}</h3>
                <p className="text-foreground text-sm">
                  {t('deleteAccount.receivedBody')}
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-foreground mb-1.5">
                   {t('deleteAccount.emailLabel')}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="glass-input w-full rounded-xl p-3 text-foreground caret-primary outline-none placeholder:text-muted-foreground focus:border-primary/70 focus:ring-2 focus:ring-primary/25 transition-[border-color,box-shadow]"
                  disabled={requestDeletion.isPending}
                />
              </div>
              {failed && (
                <p className="text-red-400 text-sm" role="alert" aria-live="assertive">
                  {t('deleteAccount.error')}
                </p>
              )}
              <button
                type="submit"
                disabled={requestDeletion.isPending || !email}
                className="w-full glass py-3 rounded-xl text-foreground font-semibold hover:bg-muted/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center justify-center gap-2"
              >
                {requestDeletion.isPending ? t('deleteAccount.submitting') : t('deleteAccount.submit')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
