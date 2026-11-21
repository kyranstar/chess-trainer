/**
 * The three looks an account chooses between (owner, 2026-11-20; ADR-064): Clubroom (the app's
 * green-and-buff identity), Studio (light, modern, cobalt) and Night (always dark, walnut board,
 * amber). Every colour, font, radius and shadow a component uses is a token here; `applyLook`
 * writes them as CSS custom properties on <html>, so `src/styles.css` styles every look through
 * `var(--…)` with no per-look markup. The tokens are data so that their contrast can be tested
 * (`looks.test.ts`): text at 4.5:1 or better on its ground, and the move chips (You, Game, Best,
 * Other) apart from each other and from the look's main colour, light and dark.
 */
export const LOOK_IDS = ['clubroom', 'studio', 'night'] as const;
export type LookId = (typeof LOOK_IDS)[number];
export type Tokens = Record<string, string>;

const UI_ATKINSON = "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, -apple-system, 'Segoe UI', sans-serif";
const UI_INTER = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
const DISPLAY_GROTESK = "'Space Grotesk Variable', 'Space Grotesk', 'Inter Variable', system-ui, sans-serif";
const BOOK = "'Literata Variable', Literata, Georgia, 'Times New Roman', serif";

/** Chart colours (ADR-061/062), validated with the dataviz validator: one set for light grounds, one for dark. */
const CHARTS_LIGHT: Tokens = {
  'ch-a': '#1d5fa8', 'ch-bad': '#b0362d',
  'dv-n3': '#b0362d', 'dv-n2': '#d2604f', 'dv-n1': '#e89c92', 'dv-0': '#e2e4e0', 'dv-p1': '#8db3e2', 'dv-p2': '#4f86cc', 'dv-p3': '#1d5fa8',
  'neutral-mark': '#b4bbb4',
};
const CHARTS_DARK: Tokens = {
  'ch-a': '#4f95ec', 'ch-bad': '#e05a50',
  'dv-n3': '#f27f73', 'dv-n2': '#c4564a', 'dv-n1': '#8a4038', 'dv-0': '#3d4741', 'dv-p1': '#2d5a8f', 'dv-p2': '#3f7fcc', 'dv-p3': '#74b0f5',
  'neutral-mark': '#66716a',
};
/** Verdicts and moves on a light ground and on a dark one. */
const MARKS_LIGHT: Tokens = {
  flag: '#b0362d', 'flag-soft': '#f9e4e1', good: '#26734a', 'good-soft': '#dff0e4', pencil: '#e0a526', 'pencil-soft': '#fbf0cf',
  you: '#96600a', 'you-soft': '#fbf0cf', game: '#55626e', 'game-soft': '#e7eaed', best: '#1d5fa8', 'best-soft': '#dfeaf7', other: '#6b4aa8', 'other-soft': '#ece5f7',
};
const MARKS_DARK: Tokens = {
  flag: '#f08a80', 'flag-soft': '#3b1d1a', good: '#86d3a4', 'good-soft': '#163423', pencil: '#e0a526', 'pencil-soft': '#3a3115',
  you: '#e8b23c', 'you-soft': '#3a3115', game: '#aab5bf', 'game-soft': '#262f37', best: '#8ab8ef', 'best-soft': '#1b2c40', other: '#c0a5ee', 'other-soft': '#2c2440',
};

const clubroomLight: Tokens = {
  paper: '#F3F1EA', surface: '#FFFFFF', ink: '#1B241E', muted: '#5B665E', rule: '#E2DED2',
  felt: '#1F4D36', 'felt-ink': '#F3EFDD', 'secondary-bg': '#FFFFFF', 'secondary-ink': '#1B241E', 'secondary-border': '#D6D1C3',
  'tab-bg': '#FFFFFF', 'shadow-card': 'none', 'radius-card': '14px', 'radius-button': '12px',
  'board-light': '#ECE6CF', 'board-dark': '#6F9468',
  ui: UI_ATKINSON, display: UI_ATKINSON, book: BOOK,
  ...MARKS_LIGHT, ...CHARTS_LIGHT,
};

export const LOOKS: Record<LookId, { name: string; blurb: string; light: Tokens; dark: Tokens | null }> = {
  clubroom: {
    name: 'Clubroom',
    blurb: 'Green and buff, like a club board',
    light: clubroomLight,
    dark: {
      ...clubroomLight,
      paper: '#0f1713', surface: '#18231c', ink: '#e7ece5', muted: '#a3b3a8', rule: '#2e3d33',
      felt: '#9fd0a6', 'felt-ink': '#0f1713', 'secondary-bg': '#18231c', 'secondary-ink': '#e7ece5', 'secondary-border': '#34463a',
      'tab-bg': '#121c16',
      ...MARKS_DARK, ...CHARTS_DARK,
    },
  },
  studio: {
    name: 'Studio',
    blurb: 'Light and modern',
    light: {
      ...clubroomLight,
      paper: '#F7F8FA', surface: '#FFFFFF', ink: '#0F172A', muted: '#5A6475', rule: '#E6E9EF',
      felt: '#2453D8', 'felt-ink': '#FFFFFF', 'secondary-bg': '#E3E9F7', 'secondary-ink': '#1B3FA8', 'secondary-border': '#E3E9F7',
      'tab-bg': '#FFFFFF', 'shadow-card': '0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.06)', 'radius-card': '18px', 'radius-button': '14px',
      'board-light': '#E3E9F2', 'board-dark': '#8AA0BF',
      ui: UI_INTER, display: UI_INTER,
      // Best is teal here: blue is this look's main colour.
      best: '#0E7C86', 'best-soft': '#DDF1F2',
    },
    dark: {
      ...clubroomLight,
      paper: '#0E1116', surface: '#171B22', ink: '#E8ECF2', muted: '#A3ADBD', rule: '#262C36',
      felt: '#7B9BFF', 'felt-ink': '#0B1020', 'secondary-bg': '#1E2533', 'secondary-ink': '#C3D0FF', 'secondary-border': '#1E2533',
      'tab-bg': '#12161C', 'shadow-card': 'none', 'radius-card': '18px', 'radius-button': '14px',
      'board-light': '#E3E9F2', 'board-dark': '#8AA0BF',
      ui: UI_INTER, display: UI_INTER,
      ...MARKS_DARK, ...CHARTS_DARK,
      best: '#4FC3C9', 'best-soft': '#12302F',
    },
  },
  night: {
    name: 'Night',
    blurb: 'Dark, with a wood board',
    light: {
      ...clubroomLight,
      paper: '#111315', surface: '#1B1E22', ink: '#ECEEF0', muted: '#A0A7B0', rule: '#2A2E34',
      felt: '#F0B44C', 'felt-ink': '#1A1405', 'secondary-bg': '#1B1E22', 'secondary-ink': '#ECEEF0', 'secondary-border': '#2F343B',
      'tab-bg': '#15171A', 'shadow-card': 'none', 'radius-card': '18px', 'radius-button': '14px',
      'board-light': '#F0D9B5', 'board-dark': '#B58863',
      ui: UI_INTER, display: DISPLAY_GROTESK,
      ...MARKS_DARK, ...CHARTS_DARK,
      // You is pink here: amber is this look's main colour.
      you: '#EE8FC8', 'you-soft': '#3A1D30', pencil: '#F0B44C',
    },
    dark: null,
  },
};

export function resolveTokens(id: LookId, systemDark: boolean): Tokens {
  const look = LOOKS[id] ?? LOOKS.clubroom;
  return systemDark && look.dark ? look.dark : look.light;
}

/** True when the look is dark as resolved now (Night always; the others when the system is). */
export function isDark(id: LookId, systemDark: boolean): boolean {
  return id === 'night' || (systemDark && !!LOOKS[id]?.dark);
}

export const LOOK_KEY = 'ct.look';
export const LOOK_SETTING = 'look';

export function isLookId(x: unknown): x is LookId {
  return typeof x === 'string' && (LOOK_IDS as readonly string[]).includes(x);
}

/** The look last chosen on this device (before an account's setting is read), else Clubroom. */
export function storedLook(): LookId {
  try {
    const v = localStorage.getItem(LOOK_KEY);
    return isLookId(v) ? v : 'clubroom';
  } catch {
    return 'clubroom';
  }
}

let current: LookId = 'clubroom';
let listening = false;

/** Paints the app in a look: its tokens on <html>, its scheme for form controls, the bar colour. */
export function applyLook(id: LookId): void {
  current = isLookId(id) ? id : 'clubroom';
  try {
    localStorage.setItem(LOOK_KEY, current);
  } catch {
    // Storage blocked: the look applies for this visit.
  }
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const dark = !!media?.matches;
  const tokens = resolveTokens(current, dark);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${k}`, v);
  root.dataset.look = current;
  root.style.colorScheme = isDark(current, dark) ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.paper!);
  if (!listening && media) {
    listening = true;
    media.addEventListener?.('change', () => applyLook(current));
  }
}

export function currentLook(): LookId {
  return current;
}

// Colour arithmetic for the tests and the picker.
function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** Distance in OKLab: how far apart two colours look. */
export function oklabDistance(a: string, b: string): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
