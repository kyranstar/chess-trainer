import type { OpeningBook } from './repertoire';

/** Rating band used until the learner picks one: 800 to 1000 on the Lichess scale. */
export const DEFAULT_BAND = 1;

let cache: Promise<OpeningBook | null> | null = null;

/** The move-frequency book (a static, precached file); null when it is not on the device. A failed load is tried again next time. */
export function loadOpeningBook(): Promise<OpeningBook | null> {
  if (!cache) {
    const attempt: Promise<OpeningBook | null> = fetch('./packs/openings-lichess.json')
      .then((r) => (r.ok ? (r.json() as Promise<OpeningBook>) : null))
      .then((b) => (b && b.positions ? b : null))
      .catch(() => null);
    cache = attempt;
    void attempt.then((b) => {
      if (!b && cache === attempt) cache = null;
    });
  }
  return cache;
}
