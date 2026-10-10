import { useI18n } from '@/i18n';

export default function Terms() {
  const { t } = useI18n();
  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-2xl mx-auto py-12 px-4">
      <h1 className="font-serif">{t('terms.title')}</h1>
      <p>{t('terms.lastUpdated')}</p>

      <h3>{t('terms.s1Title')}</h3>
      <p>{t('terms.s1Body')}</p>

      <h3>{t('terms.s2Title')}</h3>
      <p>{t('terms.s2Body')}</p>

      <h3>{t('terms.s3Title')}</h3>
      <p>{t('terms.s3Body')}</p>

      <h3>{t('terms.s4Title')}</h3>
      <p>{t('terms.s4Body')}</p>
    </div>
  );
}
