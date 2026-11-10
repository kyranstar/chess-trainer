/**
 * Guard against a second tap landing on the next screen.
 *
 * A double tap (or an impatient second tap) on "Next position" arrives after the screen has
 * already changed, on whatever control now sits under the finger: it answered the next
 * question unseen, pressed "Show the move", or ended a block. Screens tell this module when
 * what they show has changed (`useScreenChange`), and their action buttons stay disabled for
 * a moment after any such change (`useArmed`).
 */
import { useEffect, useState } from 'react';

/** Long enough to swallow the second tap of a double tap; short enough not to be felt. */
export const ARM_MS = 400;

let lastChange = 0;
const listeners = new Set<() => void>();

export function noteScreenChange(): void {
  lastChange = performance.now();
  listeners.forEach((l) => l());
}

/** Call with a key that changes whenever the screen shows something new to act on. */
export function useScreenChange(key: unknown): void {
  useEffect(() => {
    noteScreenChange();
  }, [key]);
}

/** False for ARM_MS after the component appears and after every noted screen change. */
export function useArmed(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      setArmed(false);
      clearTimeout(timer);
      const wait = Math.max(0, ARM_MS - (performance.now() - lastChange));
      timer = setTimeout(() => setArmed(true), wait);
    };
    listeners.add(arm);
    // On mount: wait out the change that brought this screen up (or a full interval if none was noted).
    if (performance.now() - lastChange >= ARM_MS) lastChange = performance.now();
    arm();
    return () => {
      listeners.delete(arm);
      clearTimeout(timer);
    };
  }, []);
  return armed;
}
