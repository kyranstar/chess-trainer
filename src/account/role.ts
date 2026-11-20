/**
 * Who is using the app on this device, for the things that are the owner's alone (ADR-063):
 * flags, the private GitHub copy, his Chessreps courses, his starting ratings.
 * `local`: a build without accounts (development, tests, a copy built from source), which
 * behaves as the app always has.
 */
export type Role = 'local' | 'admin' | 'member';

let role: Role = 'local';
export function setRole(r: Role): void {
  role = r;
}
export function currentRole(): Role {
  return role;
}
export function isAdminLike(): boolean {
  return role !== 'member';
}
