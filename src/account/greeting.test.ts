import { describe, expect, it } from 'vitest';
import { greeting } from './greeting';

const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m);

describe('the greeting on Today', () => {
  it('says morning, afternoon or evening by the local hour', () => {
    expect(greeting(at(5), 'Sam')).toBe('Good morning, Sam');
    expect(greeting(at(11, 59), 'Sam')).toBe('Good morning, Sam');
    expect(greeting(at(12), 'Sam')).toBe('Good afternoon, Sam');
    expect(greeting(at(16, 59), 'Sam')).toBe('Good afternoon, Sam');
    expect(greeting(at(17), 'Sam')).toBe('Good evening, Sam');
    expect(greeting(at(2), 'Sam')).toBe('Good evening, Sam');
  });
  it('leaves the name off when there is none', () => {
    expect(greeting(at(9), '')).toBe('Good morning');
  });
});
