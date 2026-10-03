import type { Locale, Translation } from './types';

import en from './locales/en';
import ja from './locales/ja';
import pt from './locales/pt';
import fr from './locales/fr';
import es from './locales/es';
import ko from './locales/ko';
import de from './locales/de';
import it from './locales/it';
import ru from './locales/ru';
import zhCN from './locales/zh-CN';
import ar from './locales/ar';
import th from './locales/th';
import vi from './locales/vi';
import id from './locales/id';
import hi from './locales/hi';
import lo from './locales/lo';

// English is the complete source-of-truth dictionary; the others are partial
// and fall back to English per key.
export const dictionaries: Record<Locale, Translation | Partial<Translation>> = {
  en,
  ja,
  pt,
  fr,
  es,
  ko,
  de,
  it,
  ru,
  'zh-CN': zhCN,
  ar,
  th,
  vi,
  id,
  hi,
  lo,
};

export { en as baseDictionary };
