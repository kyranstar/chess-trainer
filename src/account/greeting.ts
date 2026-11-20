/** "Good evening, Sam" (owner request, 2026-11-20): Today greets an invited friend by the name the owner gave them. */
export function greeting(now: Date, name: string): string {
  const h = now.getHours();
  const part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'evening';
  return name ? `Good ${part}, ${name}` : `Good ${part}`;
}
