import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STYLE,
  DEFAULT_THEME,
  MAX_CHARS,
  layoutFlags,
  parseStyle,
  parseTheme,
  splitMessage,
  textColorFor,
} from '../../app/lib/flagparty';

const text = (lines: string[][]) => lines.map((line) => line.join(''));
const sagOf = (message: string) =>
  layoutFlags(splitMessage(message), 'birthday', 'mono').sag;

describe('splitMessage', () => {
  it('keeps a short message on one line', () => {
    expect(text(splitMessage('Happy Birthday'))).toEqual(['Happy Birthday']);
  });

  it('breaks a long message at the most balanced space', () => {
    expect(text(splitMessage('Happy Birthday Morgan and Marie'))).toEqual([
      'Happy Birthday',
      'Morgan and Marie',
    ]);
  });

  it('honors the slash as the chosen break', () => {
    expect(text(splitMessage('Happy Birthday Morgan/and Marie'))).toEqual([
      'Happy Birthday Morgan',
      'and Marie',
    ]);
  });

  it('keeps later slashes as flags', () => {
    expect(text(splitMessage('Yay/1/2'))).toEqual(['Yay', '1/2']);
  });

  it('falls back to one line when a side of the slash is empty', () => {
    expect(text(splitMessage('Congrats/'))).toEqual(['Congrats']);
    expect(text(splitMessage('/ Congrats '))).toEqual(['Congrats']);
  });

  it('keeps a long message without spaces on one line', () => {
    expect(splitMessage('Supercalifragilistic')).toHaveLength(1);
  });

  it('collapses whitespace and returns nothing for a blank message', () => {
    expect(text(splitMessage('  hi   there  '))).toEqual(['hi there']);
    expect(splitMessage('   ')).toEqual([]);
    expect(splitMessage()).toEqual([]);
  });

  it('caps the message across both lines', () => {
    const lines = splitMessage(`${'a'.repeat(30)}/${'b'.repeat(30)}`);
    expect(lines.flat()).toHaveLength(MAX_CHARS);
    expect(lines[1]).toHaveLength(MAX_CHARS - 30);
  });

  it('caps a very long query string', () => {
    expect(
      splitMessage('ab '.repeat(100_000)).flat().length
    ).toBeLessThanOrEqual(MAX_CHARS);
  });

  it('gives an emoji a single flag', () => {
    expect(splitMessage('hi 👩‍👩‍👧')[0]).toEqual(['h', 'i', ' ', '👩‍👩‍👧']);
  });
});

describe('parameters', () => {
  it('falls back to defaults for unknown values', () => {
    expect(parseTheme('nope')).toBe(DEFAULT_THEME);
    expect(parseTheme()).toBe(DEFAULT_THEME);
    expect(parseTheme('Pastel')).toBe('pastel');
    expect(parseStyle('square')).toBe(DEFAULT_STYLE);
    expect(parseStyle('CIRCLE')).toBe('circle');
  });

  it('picks readable letters for the flag color', () => {
    expect(textColorFor('#1d3557')).toBe('#ffffff');
    expect(textColorFor('#ffd23f')).toBe('#1b1b1f');
    expect(textColorFor('#ffc8dd')).toBe('#1b1b1f');
  });
});

describe('layoutFlags', () => {
  it('places one flag per non-space character', () => {
    const layout = layoutFlags(splitMessage('Hi Mo'), 'birthday', 'mono');
    expect(layout.flags.map((f) => f.char)).toEqual(['H', 'i', 'M', 'o']);
    expect(layout.ropes).toHaveLength(1);
  });

  it('sags a single string deeper than two', () => {
    expect(sagOf('Hooray')).toBeGreaterThan(sagOf('Hooray/Again'));
  });

  it('uses one flag size for both lines and keeps them inside the view', () => {
    const layout = layoutFlags(
      splitMessage('Happy Birthday Morgan and Marie'),
      'pastel',
      'duo'
    );
    expect(layout.ropes).toHaveLength(2);
    for (const flag of layout.flags) {
      expect(flag.x - layout.flagWidth / 2).toBeGreaterThan(0);
      expect(flag.x + layout.flagWidth / 2).toBeLessThan(layout.width);
      expect(flag.y + layout.flagHeight).toBeLessThanOrEqual(layout.height);
    }
  });

  it('caps flag size for very short messages', () => {
    const layout = layoutFlags(splitMessage('A'), 'birthday', 'circle');
    expect(layout.flagWidth).toBeLessThanOrEqual(130);
    expect(layout.flags[0].x).toBeCloseTo(layout.width / 2);
  });

  it('renders nothing for an empty message', () => {
    const layout = layoutFlags([], 'birthday', 'mono');
    expect(layout.flags).toEqual([]);
    expect(layout.height).toBe(0);
  });
});
