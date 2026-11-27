import { describe, expect, it } from 'vitest';

import {
  CORD,
  DEFAULT_STYLE,
  DEFAULT_FONT,
  DEFAULT_THEME,
  MAX_CHARS,
  layoutFlags,
  parseFont,
  parseStyle,
  parseTheme,
  splitMessage,
  TEXT_COLORS,
  THEMES,
} from '../../app/lib/flagparty';

const text = (lines: string[][]) => lines.map((line) => line.join(''));
const sagOf = (message: string) =>
  layoutFlags(splitMessage(message), THEMES['birthday-dark'], 'mono').sag;

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
    const lines = splitMessage(`${'a'.repeat(20)}/${'b'.repeat(20)}`);
    expect(lines.flat()).toHaveLength(MAX_CHARS);
    expect(lines[1]).toHaveLength(MAX_CHARS - 20);
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

describe('parseTheme', () => {
  it('resolves named themes and their short aliases', () => {
    expect(parseTheme('Pastel')).toBe(THEMES.pastel);
    expect(parseTheme('birthday')).toBe(THEMES['birthday-dark']);
    expect(parseTheme('anniversary')).toBe(THEMES['anniversary-gold']);
    expect(parseTheme('anniversary-silver')).toBe(THEMES['anniversary-silver']);
  });

  it('falls back to the default theme for unknown values', () => {
    expect(parseTheme('nope')).toBe(THEMES[DEFAULT_THEME]);
    expect(parseTheme()).toBe(THEMES[DEFAULT_THEME]);
    expect(parseTheme('color-zzzzzz')).toBe(THEMES[DEFAULT_THEME]);
    expect(parseTheme('color-')).toBe(THEMES[DEFAULT_THEME]);
  });

  it('paints every flag a fixed hex color', () => {
    const theme = parseTheme('color-FF00FF');
    expect(theme.fills).toEqual(['#ff00ff']);
    expect(theme.accents).toEqual(['#cc00cc']);
  });

  it('cycles several fixed colors and expands short hex', () => {
    const theme = parseTheme('color-f0f-00aaff');
    expect(theme.fills).toEqual(['#ff00ff', '#00aaff']);
    expect(theme.accents).toBeUndefined();
  });

  it('picks one letter tone that reads on every fixed color', () => {
    expect(parseTheme('color-1d3557').text).toBe('light');
    expect(parseTheme('color-ffe680').text).toBe('dark');
  });
});

describe('parseStyle', () => {
  it('falls back to mono', () => {
    expect(parseStyle('square')).toBe(DEFAULT_STYLE);
    expect(parseStyle('CIRCLE')).toBe('circle');
  });
});

describe('parseFont', () => {
  it('defaults to Fredoka semibold', () => {
    const font = parseFont();
    expect(font.family.startsWith(`'${DEFAULT_FONT}'`)).toBe(true);
    expect(font.weight).toBe(600);
    expect(font.href).toBe(
      'https://fonts.googleapis.com/css2?family=Fredoka:wght@600&display=swap'
    );
  });

  it('loads any Google font by name', () => {
    const font = parseFont('Baloo  2');
    expect(font.family.startsWith("'Baloo 2'")).toBe(true);
    expect(font.weight).toBe(400);
    expect(font.href).toBe(
      'https://fonts.googleapis.com/css2?family=Baloo+2&display=swap'
    );
  });

  it('adds a valid weight and ignores a bad one', () => {
    expect(parseFont('Bungee', '700').href).toContain(
      'family=Bungee:wght@700&'
    );
    expect(parseFont('Bungee', '750').weight).toBe(400);
  });

  it('refuses names that could break out of the stylesheet URL', () => {
    expect(parseFont('Roboto&family=Evil').family).toContain(DEFAULT_FONT);
    expect(parseFont("x'; color: red").family).toContain(DEFAULT_FONT);
  });
});

describe('layoutFlags', () => {
  it('places one flag per non-space character', () => {
    const layout = layoutFlags(
      splitMessage('Hi Mo'),
      THEMES['birthday-dark'],
      'mono'
    );
    expect(layout.flags.map((f) => f.char)).toEqual(['H', 'i', 'M', 'o']);
    expect(layout.ropes).toHaveLength(1);
  });

  it('uses one letter color for the whole theme', () => {
    expect(layoutFlags([['a']], THEMES.pastel, 'mono').text).toBe(
      TEXT_COLORS.dark
    );
    expect(layoutFlags([['a']], THEMES['birthday-dark'], 'mono').text).toBe(
      TEXT_COLORS.light
    );
  });

  it('hangs each flag from a cord below the string', () => {
    const layout = layoutFlags([['a']], THEMES.pastel, 'duo');
    expect(layout.cordLength).toBeCloseTo(layout.flagWidth * CORD);
    expect(layout.flagHeight).toBeGreaterThan(layout.cordLength);
  });

  it('sags a single string deeper than two', () => {
    expect(sagOf('Hooray')).toBeGreaterThan(sagOf('Hooray/Again'));
  });

  it('uses one flag size for both lines and keeps them inside the view', () => {
    const layout = layoutFlags(
      splitMessage('Happy Birthday Morgan and Marie'),
      THEMES.pastel,
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
    const layout = layoutFlags(
      splitMessage('A'),
      THEMES['birthday-dark'],
      'circle'
    );
    expect(layout.flagWidth).toBeLessThanOrEqual(130);
    expect(layout.flags[0].x).toBeCloseTo(layout.width / 2);
  });

  it('renders nothing for an empty message', () => {
    const layout = layoutFlags([], THEMES['birthday-dark'], 'mono');
    expect(layout.flags).toEqual([]);
    expect(layout.height).toBe(0);
  });
});
