import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useI18n, LOCALES, LOCALE_META } from '@/i18n';

const STORAGE_KEY = 'los_lang_fab_pos';
const MARGIN = 16;
const BUTTON_SIZE = 48;
// Keep the draggable trigger clear of iOS home indicators and Android gesture bars.
const SAFE_AREA_BOTTOM_CLEARANCE = 24;
// Extra clearance above the mobile bottom action/nav, including notched-device
// safe areas, so the control never overlaps the primary action.
const NAV_CLEARANCE = 150;
// Movement (px) beyond which a pointer gesture counts as a drag, not a tap.
const DRAG_THRESHOLD = 6;
// A focused text field plus this much lost viewport height indicates a software keyboard.
const KEYBOARD_HEIGHT_THRESHOLD = 120;

interface Position {
  x: number;
  y: number;
}

interface FloatingLanguageControlProps {
  /** When true, keep clearance above the mobile bottom nav. */
  navReserved?: boolean;
}

function visibleViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  return window.visualViewport?.height ?? window.innerHeight;
}

function hasTextEntryFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || (active instanceof HTMLElement && active.isContentEditable)
  );
}

function clampToViewport(pos: Position, navReserved: boolean): Position {
  if (typeof window === 'undefined') return pos;
  const bottomInset = navReserved ? NAV_CLEARANCE : MARGIN + SAFE_AREA_BOTTOM_CLEARANCE;
  const maxX = window.innerWidth - BUTTON_SIZE - MARGIN;
  const maxY = window.innerHeight - BUTTON_SIZE - bottomInset;
  return {
    x: Math.min(Math.max(pos.x, MARGIN), Math.max(MARGIN, maxX)),
    y: Math.min(Math.max(pos.y, MARGIN), Math.max(MARGIN, maxY)),
  };
}

function defaultPosition(navReserved: boolean): Position {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const bottomInset = navReserved ? NAV_CLEARANCE : MARGIN + SAFE_AREA_BOTTOM_CLEARANCE;
  return {
    x: window.innerWidth - BUTTON_SIZE - MARGIN,
    y: window.innerHeight - BUTTON_SIZE - bottomInset,
  };
}

function loadPosition(navReserved: boolean): Position {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Position;
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampToViewport(parsed, navReserved);
      }
    }
  } catch {
    /* ignore malformed / unavailable storage */
  }
  return defaultPosition(navReserved);
}

export default function FloatingLanguageControl({
  navReserved = false,
}: FloatingLanguageControlProps) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [pos, setPos] = useState<Position>({ x: 0, y: 0 });

  const posRef = useRef<Position>(pos);
  posRef.current = pos;
  const maxViewportHeightRef = useRef(0);
  const keyboardOpenRef = useRef(false);

  // Gesture tracking refs — never trigger re-renders during a drag.
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startRef = useRef<{ px: number; py: number; ox: number; oy: number }>({
    px: 0,
    py: 0,
    ox: 0,
    oy: 0,
  });

  // Initialize position from storage once mounted (needs window dimensions).
  useEffect(() => {
    setPos(loadPosition(navReserved));
    maxViewportHeightRef.current = visibleViewportHeight();
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the control on-screen when the viewport resizes / rotates. When a
  // software keyboard opens, temporarily hide it instead of covering the
  // focused field or the content immediately above the keyboard.
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      const currentHeight = visibleViewportHeight();
      const textEntryFocused = hasTextEntryFocus();

      if (!textEntryFocused) {
        maxViewportHeightRef.current = Math.max(maxViewportHeightRef.current, currentHeight);
      }

      const nextKeyboardOpen =
        textEntryFocused
        && maxViewportHeightRef.current - currentHeight >= KEYBOARD_HEIGHT_THRESHOLD;

      if (nextKeyboardOpen !== keyboardOpenRef.current) {
        keyboardOpenRef.current = nextKeyboardOpen;
        setKeyboardOpen(nextKeyboardOpen);
        setOpen(false);

        if (!nextKeyboardOpen) {
          setPos(loadPosition(navReserved));
        }
      } else if (!nextKeyboardOpen) {
        setPos((prev) => clampToViewport(prev, navReserved));
      }
    };

    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    visualViewport?.addEventListener('resize', syncViewport);
    visualViewport?.addEventListener('scroll', syncViewport);
    document.addEventListener('focusin', syncViewport);
    document.addEventListener('focusout', syncViewport);

    return () => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
      visualViewport?.removeEventListener('resize', syncViewport);
      visualViewport?.removeEventListener('scroll', syncViewport);
      document.removeEventListener('focusin', syncViewport);
      document.removeEventListener('focusout', syncViewport);
    };
  }, [navReserved]);

  const persist = useCallback((next: Position) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // Only start a drag for primary pointer.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // Radix opens dropdown triggers on pointer-down. This control owns the
      // tap-vs-drag decision, so prevent Radix from opening until pointer-up
      // confirms the gesture was a tap.
      e.preventDefault();
      draggingRef.current = true;
      movedRef.current = false;
      startRef.current = {
        px: e.clientX,
        py: e.clientY,
        ox: posRef.current.x,
        oy: posRef.current.y,
      };
      // Capture so we keep receiving move/up even if the finger leaves the button.
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - startRef.current.px;
      const dy = e.clientY - startRef.current.py;
      if (!movedRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        movedRef.current = true;
      }
      if (movedRef.current) {
        const next = clampToViewport(
          { x: startRef.current.ox + dx, y: startRef.current.oy + dy },
          navReserved,
        );
        setPos(next);
      }
    },
    [navReserved],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (movedRef.current) {
        // Was a drag — persist and suppress the tap-to-open.
        persist(posRef.current);
      } else {
        // Was a tap — toggle the language menu open.
        setOpen((prev) => !prev);
      }
    },
    [persist],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (movedRef.current) persist(posRef.current);
    },
    [persist],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('language.change')}
          aria-hidden={keyboardOpen || undefined}
          tabIndex={keyboardOpen ? -1 : undefined}
          data-testid="button-floating-language"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onClick={(e) => {
            // Opening is driven by pointerup; block the synthetic click so the
            // dropdown trigger doesn't double-toggle.
            e.preventDefault();
          }}
          className="md:hidden fixed flex items-center justify-center rounded-full border border-popover-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-xl glow-violet focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          style={{
            left: pos.x,
            top: pos.y,
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            zIndex: 60,
            touchAction: 'none',
            visibility: ready && !keyboardOpen ? 'visible' : 'hidden',
            pointerEvents: keyboardOpen ? 'none' : 'auto',
          }}
        >
          <span className="flex flex-col items-center leading-none">
            <Globe className="w-4 h-4" />
            <span className="text-[9px] uppercase mt-0.5" data-testid="text-floating-locale">
              {locale}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="z-[70] max-h-[70dvh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto border-popover-border bg-popover p-2 text-popover-foreground shadow-2xl"
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
              onSelect={() => {
                setLocale(code);
                setOpen(false);
              }}
              data-testid={`option-floating-locale-${code}`}
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
