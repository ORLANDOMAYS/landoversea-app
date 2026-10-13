import { useState } from 'react';
import { Globe, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useI18n, LOCALES, LOCALE_META, type Locale } from '@/i18n';

interface LanguageSwitcherProps {
  /** `compact` renders a smaller icon-only trigger for the mobile shell. */
  variant?: 'default' | 'compact';
  className?: string;
}

export default function LanguageSwitcher({
  variant = 'default',
  className = '',
}: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const isCompact = variant === 'compact';

  const handleSelect = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('language.change')}
          data-testid="button-language-switcher"
          className={`flex items-center gap-1 rounded-full border border-popover-border bg-popover/90 text-popover-foreground shadow-sm backdrop-blur-xl hover:bg-popover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
            isCompact ? 'min-h-10 px-3 py-2' : 'min-h-10 px-3 py-2'
          } ${className}`}
        >
          <Globe className={isCompact ? 'w-4 h-4' : 'w-4 h-4'} />
          <span className="text-sm uppercase" data-testid="text-active-locale">
            {locale}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="max-h-[70dvh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto border-popover-border bg-popover p-2 text-popover-foreground shadow-2xl"
      >
        <div className="px-3 pb-2 pt-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground select-none">
          {t('language.select')}
        </div>
        {LOCALES.map((code) => {
          const meta = LOCALE_META[code];
          const selected = code === locale;
          return (
            <DropdownMenuItem
              key={code}
              onSelect={() => handleSelect(code)}
              data-testid={`option-locale-${code}`}
              aria-current={selected ? 'true' : undefined}
              className={`flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer text-sm outline-none ${
                selected
                  ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/35 focus:bg-primary/20 focus:text-primary'
                  : 'text-popover-foreground focus:bg-muted focus:text-popover-foreground'
              }`}
              dir={meta.dir}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{meta.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {meta.englishName}
                </span>
              </span>
              {selected && (
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
