/**
 * Where the app runs, for the install guide and for how to sign in (ADR-063).
 *
 * An app added to the Home Screen on iPhone or iPad, and a Safari web app on the Mac, has its
 * own storage, separate from the browser's; on Android and in desktop Chrome the installed app
 * shares the browser's. So on the first kind the install step comes before sign-in, and sign-in
 * happens once, inside the installed app.
 */
export type Platform = 'ios' | 'mac-safari' | 'android' | 'desktop';

export function platform(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): Platform {
  const ua = nav.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua)) return 'mac-safari';
  return 'desktop';
}

export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const BROWSER_OK_KEY = 'ct.browserOk';

/** Install before signing in: a platform whose installed app has its own storage, not yet installed. */
export function installFirst(): boolean {
  const p = platform();
  let browserOk = false;
  try {
    browserOk = localStorage.getItem(BROWSER_OK_KEY) === '1';
  } catch {
    // Storage blocked: ask again next time.
  }
  return (p === 'ios' || p === 'mac-safari') && !isInstalled() && !browserOk;
}

/** A phone, or the installed app: sign in by redirect, which works where popups do not. */
export function preferRedirect(): boolean {
  const p = platform();
  return p === 'ios' || p === 'android' || isInstalled();
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  // Chrome on Android and the desktop offer their own install prompt; it is kept for a button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    promptListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    promptListeners.forEach((l) => l());
  });
}

/** The browser's own install prompt where it offers one (Android and desktop Chrome), else null. */
export function installPrompt(): (() => Promise<boolean>) | null {
  const e = deferred;
  if (!e) return null;
  return async () => {
    await e.prompt();
    const choice = await e.userChoice;
    deferred = null;
    return choice.outcome === 'accepted';
  };
}
export function onInstallPromptChange(l: () => void): () => void {
  promptListeners.add(l);
  return () => void promptListeners.delete(l);
}
