import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ShieldCheck, ChevronDown } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';

interface AdviceTopic {
  emoji: string;
  titleKey: TranslationKey;
  color: string;
  iconBg: string;
  iconColor: string;
  tipKeys: TranslationKey[];
}

const TOPICS: AdviceTopic[] = [
  {
    emoji: '🔐',
    titleKey: 'safetyAdvice.topics.online.title',
    color: 'border-violet-500',
    iconBg: 'bg-violet-500/20',
    iconColor: 'text-violet-400',
    tipKeys: [
      'safetyAdvice.topics.online.tip1',
      'safetyAdvice.topics.online.tip2',
      'safetyAdvice.topics.online.tip3',
      'safetyAdvice.topics.online.tip4',
    ],
  },
  {
    emoji: '🤝',
    titleKey: 'safetyAdvice.topics.firstMeeting.title',
    color: 'border-pink-500',
    iconBg: 'bg-pink-500/20',
    iconColor: 'text-pink-400',
    tipKeys: [
      'safetyAdvice.topics.firstMeeting.tip1',
      'safetyAdvice.topics.firstMeeting.tip2',
      'safetyAdvice.topics.firstMeeting.tip3',
      'safetyAdvice.topics.firstMeeting.tip4',
    ],
  },
  {
    emoji: '💸',
    titleKey: 'safetyAdvice.topics.scams.title',
    color: 'border-orange-500',
    iconBg: 'bg-orange-500/20',
    iconColor: 'text-orange-400',
    tipKeys: [
      'safetyAdvice.topics.scams.tip1',
      'safetyAdvice.topics.scams.tip2',
      'safetyAdvice.topics.scams.tip3',
      'safetyAdvice.topics.scams.tip4',
    ],
  },
  {
    emoji: '🌍',
    titleKey: 'safetyAdvice.topics.travel.title',
    color: 'border-cyan-500',
    iconBg: 'bg-cyan-500/20',
    iconColor: 'text-cyan-400',
    tipKeys: [
      'safetyAdvice.topics.travel.tip1',
      'safetyAdvice.topics.travel.tip2',
      'safetyAdvice.topics.travel.tip3',
      'safetyAdvice.topics.travel.tip4',
    ],
  },
  {
    emoji: '📱',
    titleKey: 'safetyAdvice.topics.privacy.title',
    color: 'border-blue-500',
    iconBg: 'bg-blue-500/20',
    iconColor: 'text-blue-400',
    tipKeys: [
      'safetyAdvice.topics.privacy.tip1',
      'safetyAdvice.topics.privacy.tip2',
      'safetyAdvice.topics.privacy.tip3',
      'safetyAdvice.topics.privacy.tip4',
    ],
  },
  {
    emoji: '🚨',
    titleKey: 'safetyAdvice.topics.emergency.title',
    color: 'border-red-500',
    iconBg: 'bg-red-500/20',
    iconColor: 'text-red-400',
    tipKeys: [
      'safetyAdvice.topics.emergency.tip1',
      'safetyAdvice.topics.emergency.tip2',
      'safetyAdvice.topics.emergency.tip3',
      'safetyAdvice.topics.emergency.tip4',
    ],
  },
];

export default function SafetyAdvice() {
  const [, navigate] = useLocation();
  const { t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button onClick={() => navigate('/coaches')} className="w-9 h-9 rounded-full glass flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-orange-400" />
          <h1 className="font-serif text-xl text-foreground">{t('safetyAdvice.title')}</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Intro Card */}
        <div className="glass rounded-2xl p-5">
          <h2 className="font-serif text-foreground text-xl mb-2">{t('safetyAdvice.introTitle')}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('safetyAdvice.introBody')}
          </p>
        </div>

        {/* Accordion Topics */}
        <div className="space-y-3">
          {TOPICS.map((topic, i) => (
            <div key={i} className={`glass rounded-2xl overflow-hidden border-l-[3px] ${topic.color}`}>
              <button
                className="w-full px-4 py-4 flex items-center gap-3 text-left"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${topic.iconBg}`}>
                  <span className="text-lg">{topic.emoji}</span>
                </div>
                <span className="font-serif text-foreground text-base flex-1">{t(topic.titleKey)}</span>
                <motion.div
                  animate={{ rotate: openIndex === i ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </motion.div>
              </button>

              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                      {topic.tipKeys.map((tipKey, j) => (
                        <div key={j} className="flex items-start gap-2">
                          <span className="text-muted-foreground text-sm shrink-0 mt-0.5">{j + 1}.</span>
                          <p className="text-foreground text-sm leading-relaxed">{t(tipKey)}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* CTA */}
        <Link href="/safety">
          <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
            {t('safetyAdvice.reportConcern')}
          </button>
        </Link>
      </div>
    </div>
  );
}
