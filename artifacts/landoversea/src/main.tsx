import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

if ('serviceWorker' in navigator && 'caches' in window) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
        .then((registration) => registration.update())
        .catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
    });
  } else {
    // A development service worker can cache Vite source modules and keep an
    // old app running after HMR or workflow restarts. Remove any prior PWA
    // worker and its app-shell caches while developing.
    void Promise.all([
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      ),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('los-'))
            .map((key) => caches.delete(key)),
        ),
      ),
    ]);
  }
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
