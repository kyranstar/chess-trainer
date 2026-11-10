import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyUci, isCheckmate, positionFromFen } from '../chess/rules';
import { CONCEPTS, conceptOpenings, conceptThemes } from '../content';
import { CHECK } from '../learn/curriculum';
import { startRun, submitMove } from './run';
import type { PackManifest, Puzzle } from './types';

const body = readFileSync('public/packs/lichess-core.json', 'utf8');
const manifest = JSON.parse(readFileSync('public/packs/lichess-core.manifest.json', 'utf8')) as PackManifest;
const puzzles = JSON.parse(body) as Puzzle[];

describe('shipped puzzle pack', () => {
  it('matches its manifest (count, bytes, sha256) and was engine-verified', () => {
    expect(puzzles.length).toBe(manifest.count);
    expect(Buffer.byteLength(body)).toBe(manifest.bytes);
    expect(`sha256:${createHash('sha256').update(body).digest('hex')}`).toBe(manifest.contentHash);
    expect(manifest.source.license).toBe('CC0-1.0');
    expect(manifest.verification.engine).toMatch(/Stockfish/);
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length);
  });

  it('every puzzle replays legally through the app answer checker and ends solved', () => {
    for (const p of puzzles) {
      let run = startRun(p);
      expect(run.solver, p.id).not.toBe(positionFromFen(p.fen).turn);
      for (let guard = 0; guard < 10 && !run.done; guard++) {
        run = submitMove(run, run.line[run.ply]!).run;
      }
      expect(run.done, p.id).toBe(true);
      expect(run.mistakes).toBe(0);
    }
  });

  it('puzzles tagged as mates end in checkmate', () => {
    for (const p of puzzles.filter((x) => x.themes.includes('mateIn1') || x.themes.includes('mateIn2'))) {
      let pos = positionFromFen(p.fen);
      for (const u of p.moves.split(' ')) pos = applyUci(pos, u);
      expect(isCheckmate(pos), p.id).toBe(true);
    }
  });

  it('has enough unseen positions in the check band for every assessable concept', () => {
    for (const c of CONCEPTS) {
      const themes = conceptThemes(c);
      const openings = conceptOpenings(c);
      if (!themes.length && !openings.length) continue;
      const inBand = puzzles.filter(
        (p) => p.rating >= CHECK.band.lo && p.rating < CHECK.band.hi && (themes.some((t) => p.themes.includes(t)) || openings.some((o) => p.opening?.includes(o))),
      );
      expect(inBand.length, c.id).toBeGreaterThanOrEqual(CHECK.size * 4);
    }
  });
});
