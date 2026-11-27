/**
 * Flag Party: lays out a message as bunting, one letter per flag, hanging
 * from up to two strings across the top of an OBS browser source.
 *
 * Everything here is pure so the route can render on the server and the
 * geometry can be unit tested. All coordinates are in a fixed-width SVG
 * viewBox (VIEW_WIDTH wide); the SVG scales to the browser source width.
 */

export const VIEW_WIDTH = 1920;

/** Most characters (graphemes, spaces included) a message may hold. */
export const MAX_CHARS = 40;

/** Messages longer than this split onto two lines when they contain a space. */
export const ONE_LINE_MAX = 14;

/** The character a streamer types to force the line break. */
export const BREAK_CHAR = '/';

export const FLAG_STYLES = ['mono', 'duo', 'circle'] as const;
export type FlagStyle = (typeof FLAG_STYLES)[number];

export type FlagTheme = {
  /** Flag colors, cycled letter by letter. */
  fills: string[];
  /** The string the flags hang from. */
  rope: string;
};

export const THEMES = {
  birthday: {
    fills: [
      '#e63946',
      '#f4a261',
      '#ffd23f',
      '#2a9d8f',
      '#3a86ff',
      '#8338ec',
      '#ff006e',
    ],
    rope: '#f1ece2',
  },
  anniversary: {
    fills: ['#7b1e3a', '#c9a227', '#f5efe0'],
    rope: '#d8bd5a',
  },
  anniversary2: {
    fills: ['#1d3557', '#a8b2c1', '#e8eef5', '#457b9d'],
    rope: '#c7ced8',
  },
  pastel: {
    fills: ['#ffc8dd', '#bde0fe', '#caffbf', '#fdffb6', '#cdb4db', '#ffd6a5'],
    rope: '#f4f1ea',
  },
} satisfies Record<string, FlagTheme>;

export type ThemeName = keyof typeof THEMES;
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
export const DEFAULT_THEME: ThemeName = 'birthday';
export const DEFAULT_STYLE: FlagStyle = 'mono';

const DARK_TEXT = '#1b1b1f';
const LIGHT_TEXT = '#ffffff';

export const parseTheme = (input: string | null | undefined): ThemeName => {
  const key = (input ?? '').trim().toLowerCase();
  return (THEME_NAMES as string[]).includes(key)
    ? (key as ThemeName)
    : DEFAULT_THEME;
};

export const parseStyle = (input: string | null | undefined): FlagStyle => {
  const key = (input ?? '').trim().toLowerCase();
  return (FLAG_STYLES as readonly string[]).includes(key)
    ? (key as FlagStyle)
    : DEFAULT_STYLE;
};

/** Split a string into user-perceived characters, so emoji get one flag. */
export const graphemes = (input: string): string[] => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(input), (s) => s.segment);
};

const collapse = (input: string) => input.replaceAll(/\s+/g, ' ').trim();

/**
 * Turn the raw `message` parameter into one or two lines of graphemes.
 *
 * - The first `/` is the streamer's chosen break; later ones are kept as
 *   flags. An empty side drops back to a single line.
 * - Without a `/`, a message over ONE_LINE_MAX characters breaks at the
 *   space that keeps the longer line shortest.
 * - The message is capped at MAX_CHARS characters across both lines.
 */
export const splitMessage = (input = ''): string[][] => {
  const breakAt = input.indexOf(BREAK_CHAR);

  const lines =
    breakAt === -1
      ? autoBreak(collapse(input))
      : [
          collapse(input.slice(0, breakAt)),
          collapse(input.slice(breakAt + 1)),
        ].filter((line) => line.length > 0);

  let budget = MAX_CHARS;
  const result: string[][] = [];
  for (const line of lines) {
    const chars = graphemes(line).slice(0, budget);
    budget -= chars.length;
    // a trailing space left by the cap would hang an empty slot
    while (chars.length > 0 && chars.at(-1) === ' ') chars.pop();
    if (chars.length > 0) result.push(chars);
  }
  return result;
};

const autoBreak = (message: string): string[] => {
  if (message.length === 0) return [];
  const chars = graphemes(message);
  if (chars.length <= ONE_LINE_MAX) return [message];

  let best = -1;
  let bestLongest = Infinity;
  for (const [index, char] of chars.entries()) {
    if (char !== ' ') continue;
    const longest = Math.max(index, chars.length - index - 1);
    if (longest < bestLongest) {
      best = index;
      bestLongest = longest;
    }
  }
  if (best === -1) return [message];
  return [chars.slice(0, best).join(''), chars.slice(best + 1).join('')];
};

/** Pick dark or light letters for a flag color by WCAG relative luminance. */
export const textColorFor = (hex: string): string => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const c = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  // contrast against white vs. against near-black; take the stronger one
  const vsWhite = 1.05 / (luminance + 0.05);
  const vsDark = (luminance + 0.05) / 0.0608;
  return vsWhite >= vsDark ? LIGHT_TEXT : DARK_TEXT;
};

/** Flag height as a multiple of its width, per style. */
const ASPECT: Record<FlagStyle, number> = {
  mono: 1.3,
  duo: 1.3,
  circle: 1.3, // short hanging string plus the disc
};

/** How far each string sags at its middle, by number of lines. */
const SAG: Record<number, number> = { 1: 170, 2: 90 };

const ROPE_TOP = 24;
const LINE_GAP = 48;
const BOTTOM_PAD = 24;
const MAX_FLAG_WIDTH = 130;
/** Flags hang between these fractions of the string's width. */
const SPAN_START = 0.06;
const SPAN_END = 0.94;
/** A flag's width as a share of its slot; the rest is the gap between. */
const FILL = 0.86;
/** A space takes this share of a slot. */
const SPACE_SLOT = 0.55;

export type PlacedFlag = {
  key: string;
  char: string;
  /** Attachment point on the string. */
  x: number;
  y: number;
  /** Slope of the string at the attachment point, in degrees. */
  angle: number;
  fill: string;
  accent: string;
  text: string;
  /** Position across the whole message, for staggered animation. */
  order: number;
};

export type Rope = { d: string };

export type FlagLayout = {
  width: number;
  height: number;
  /** How far each string dips at its middle. */
  sag: number;
  flagWidth: number;
  flagHeight: number;
  ropes: Rope[];
  flags: PlacedFlag[];
  rope: string;
};

/**
 * A string is a symmetric quadratic curve from (0, top) to (VIEW_WIDTH, top).
 * With the control point at the horizontal middle, x is linear in t, so the
 * height at any x is a closed form.
 */
const ropeY = (top: number, sag: number, x: number) => {
  const t = x / VIEW_WIDTH;
  return top + 4 * sag * t * (1 - t);
};

const ropeAngle = (sag: number, x: number) => {
  const t = x / VIEW_WIDTH;
  const slope = (4 * sag * (1 - 2 * t)) / VIEW_WIDTH;
  return (Math.atan(slope) * 180) / Math.PI;
};

/** How many flag slots a line needs; a space takes a narrower slot. */
const slotsFor = (line: string[]) =>
  line.reduce((total, char) => total + (char === ' ' ? SPACE_SLOT : 1), 0);

export const layoutFlags = (
  lines: string[][],
  themeName: ThemeName,
  style: FlagStyle
): FlagLayout => {
  const theme: FlagTheme = THEMES[themeName];
  const sag = SAG[lines.length] ?? SAG[2];

  // Both lines share one flag size, set by whichever line needs the most room.
  const maxSlots = Math.max(1, ...lines.map((line) => slotsFor(line)));
  const span = (SPAN_END - SPAN_START) * VIEW_WIDTH;
  const slot = Math.min(span / maxSlots, MAX_FLAG_WIDTH / FILL);
  const flagWidth = slot * FILL;
  const flagHeight = flagWidth * ASPECT[style];

  const ropes: Rope[] = [];
  const flags: PlacedFlag[] = [];
  let order = 0;
  let colorIndex = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const top = ROPE_TOP + lineIndex * (flagHeight + LINE_GAP);
    ropes.push({
      d: `M 0 ${top} Q ${VIEW_WIDTH / 2} ${top + 2 * sag} ${VIEW_WIDTH} ${top}`,
    });

    // center the line's flags on the string
    let cursor = (VIEW_WIDTH - slotsFor(line) * slot) / 2;
    for (const [charIndex, char] of line.entries()) {
      if (char === ' ') {
        cursor += slot * SPACE_SLOT;
        continue;
      }
      const x = cursor + slot / 2;
      const fill = theme.fills[colorIndex % theme.fills.length];
      const accent = theme.fills[(colorIndex + 1) % theme.fills.length];
      flags.push({
        key: `${lineIndex}-${charIndex}`,
        char,
        x,
        y: ropeY(top, sag, x),
        angle: ropeAngle(sag, x),
        fill,
        accent,
        text: textColorFor(fill),
        order,
      });
      order += 1;
      colorIndex += 1;
      cursor += slot;
    }
  }

  const lastTop =
    ROPE_TOP + Math.max(0, lines.length - 1) * (flagHeight + LINE_GAP);
  const height =
    lines.length === 0 ? 0 : Math.ceil(lastTop + sag + flagHeight + BOTTOM_PAD);

  return {
    width: VIEW_WIDTH,
    height,
    sag,
    flagWidth,
    flagHeight,
    ropes,
    flags,
    rope: theme.rope,
  };
};
