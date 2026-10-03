import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useOptionalI18n, type TranslationKey } from '@/i18n';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

// English fallbacks are kept inline because this boundary can render ABOVE the
// <I18nProvider> (see main.tsx). When a provider IS present we translate.
const FALLBACK_COPY: Record<string, string> = {
  'errorBoundary.title': 'Something went wrong',
  'errorBoundary.description':
    'This part of the app hit an error. The rest of the app is still running.',
  'errorBoundary.tryAgain': 'Try again',
};

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  const i18n = useOptionalI18n();
  const tr = (key: TranslationKey): string =>
    i18n ? i18n.t(key) : FALLBACK_COPY[key] ?? key;

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background p-6">
      <div className="max-w-lg w-full text-center">
        <h1 className="text-xl font-semibold text-foreground">
          {tr('errorBoundary.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr('errorBoundary.description')}
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env.DEV ? (
          <pre className="mt-4 overflow-x-auto rounded bg-card border p-3 text-left text-xs text-card-foreground">
            {error.message || String(error)}
          </pre>
        ) : null}
        <button
          type="button"
          onClick={resetError}
          className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {tr('errorBoundary.tryAgain')}
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
