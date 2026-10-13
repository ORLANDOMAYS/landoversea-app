import { useI18n } from '@/i18n';

export default function Privacy() {
  const { t } = useI18n();
  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-2xl mx-auto py-12 px-4">
      <h1 className="font-serif">{t('privacyPage.title')}</h1>
      <p>{t('privacyPage.lastUpdated')}</p>

      <h3>{t('privacyPage.s1Title')}</h3>
      <p>{t('privacyPage.s1Body')}</p>

      <h3>{t('privacyPage.s2Title')}</h3>
      <p>{t('privacyPage.s2Body')}</p>

      <h3>{t('privacyPage.s3Title')}</h3>
      <p>{t('privacyPage.s3Body')}</p>

      <h3>{t('privacyPage.s4Title')}</h3>
      <p>{t('privacyPage.s4Body')}</p>
    </div>
  );
}
