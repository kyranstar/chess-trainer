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
