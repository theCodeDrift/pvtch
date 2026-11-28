/**
 * Flag Banner: lays out a message as bunting, one letter per flag, hanging
 * from up to two strings across the top of an OBS browser source.
 *
 * Everything here is pure so the route can render on the server and the
 * geometry can be unit tested. All coordinates are in a fixed-width SVG
 * viewBox (VIEW_WIDTH wide); the SVG scales to the browser source width.
 */

export const VIEW_WIDTH = 1920;

/** Most characters (graphemes, spaces included) a message may hold. */
export const MAX_CHARS = 30;

/** Messages longer than this split onto two lines when they contain a space. */
export const ONE_LINE_MAX = 14;

/** The character a streamer types to force the line break. */
export const BREAK_CHAR = '/';

export const FLAG_STYLES = ['mono', 'duo', 'circle'] as const;
export type FlagStyle = (typeof FLAG_STYLES)[number];

/** Letters are a translucent wash of black or white, one tone per theme. */
export type TextTone = 'dark' | 'light';

export const TEXT_COLORS: Record<TextTone, string> = {
  dark: 'rgba(0, 0, 0, 0.85)',
  light: 'rgba(255, 255, 255, 0.85)',
};

export type FlagTheme = {
  /** Flag colors, cycled letter by letter. */
  fills: string[];
  /** The duo band color for each fill; defaults to the next fill. */
  accents?: string[];
  /** The string and cords the flags hang from. */
  rope: string;
  /** Every fill in a theme is chosen to read with this one letter tone. */
  text: TextTone;
};

export const THEMES = {
  'birthday-light': {
    fills: [
      '#ff9aa2',
      '#ffc285',
      '#ffe680',
      '#9be7c4',
      '#9fd0ff',
      '#c7b3ff',
      '#ffb3de',
    ],
    rope: '#f1ece2',
    text: 'dark',
  },
  'birthday-dark': {
    fills: [
      '#d62839',
      '#e0632a',
      '#1f9e89',
      '#2563eb',
      '#7c3aed',
      '#db2777',
      '#15803d',
    ],
    rope: '#f1ece2',
    text: 'light',
  },
  'anniversary-gold': {
    fills: ['#c9a227', '#e2c46a', '#f2e2b1', '#b8902e'],
    rope: '#d8bd5a',
    text: 'dark',
  },
  'anniversary-silver': {
    fills: ['#b9c0c9', '#d9dee4', '#eef1f4', '#a3abb6'],
    rope: '#c7ced8',
    text: 'dark',
  },
  pastel: {
    fills: ['#ffc8dd', '#bde0fe', '#caffbf', '#fdffb6', '#cdb4db', '#ffd6a5'],
    rope: '#f4f1ea',
    text: 'dark',
  },
} satisfies Record<string, FlagTheme>;

export type ThemeName = keyof typeof THEMES;
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
export const DEFAULT_THEME: ThemeName = 'birthday-dark';
export const DEFAULT_STYLE: FlagStyle = 'mono';

/** Short names for the default variant of a theme family. */
const THEME_ALIASES: Record<string, ThemeName> = {
  birthday: 'birthday-dark',
  anniversary: 'anniversary-gold',
};

const CUSTOM_ROPE = '#f1ece2';
const HEX = /^(?:[\da-f]{3}|[\da-f]{6})$/;

const expandHex = (hex: string) =>
  hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;

/**
 * `color-ff00ff` paints every flag one color; `color-ff00ff-00aaff` cycles
 * through several. Returns undefined unless every part is a hex code.
 */
const parseCustomTheme = (key: string): FlagTheme | undefined => {
  const match = /^colou?r-(.+)$/.exec(key);
  if (!match) return;
  const parts = match[1].split('-');
  if (parts.length === 0 || parts.length > 12) return;
  if (!parts.every((part) => HEX.test(part))) return;

  const fills = parts.map((part) => `#${expandHex(part)}`);
  // pick the tone whose worst flag still reads best
  const worst = (base: string) =>
    Math.min(...fills.map((fill) => contrast(fill, base)));
  const text: TextTone = worst('#ffffff') > worst('#000000') ? 'light' : 'dark';
  return {
    fills,
    // a single color gets a darker band of itself for the duo style
    accents: fills.length === 1 ? [shade(fills[0], 0.2)] : undefined,
    rope: CUSTOM_ROPE,
    text,
  };
};

export const parseTheme = (input: string | null | undefined): FlagTheme => {
  const key = (input ?? '').trim().toLowerCase();
  const name = THEME_ALIASES[key] ?? key;
  const named: FlagTheme | undefined = Object.hasOwn(THEMES, name)
    ? THEMES[name]
    : undefined;
  return named ?? parseCustomTheme(key) ?? THEMES[DEFAULT_THEME];
};

export const parseStyle = (input: string | null | undefined): FlagStyle => {
  const key = (input ?? '').trim().toLowerCase();
  return (FLAG_STYLES as readonly string[]).includes(key)
    ? (key as FlagStyle)
    : DEFAULT_STYLE;
};

/** Weights by name; numeric weights mean nothing to most streamers. */
export const FONT_WEIGHTS = {
  light: 300,
  medium: 500,
  bold: 700,
  black: 900,
} as const;
export type FontWeightName = keyof typeof FONT_WEIGHTS;
export const FONT_WEIGHT_NAMES = Object.keys(FONT_WEIGHTS) as FontWeightName[];

export const DEFAULT_FONT = 'Poppins';
export const DEFAULT_WEIGHT: FontWeightName = 'bold';

/** One font per look, shown in its own typeface on the configure page. */
export const FEATURED_FONTS = [
  { label: 'Sans Serif', family: 'Poppins' },
  { label: 'Serif', family: 'Playfair Display' },
  { label: 'Script', family: 'Pacifico' },
  { label: 'Marker', family: 'Permanent Marker' },
] as const;

/** Google Fonts family names this overlay accepts; safe in a URL and CSS. */
export const FONT_NAME = /^[\d A-Za-z]{1,64}$/;
const FALLBACK_FONTS =
  "'Arial Rounded MT Bold', 'Segoe UI Black', 'Helvetica Neue', Arial, sans-serif";

export type FlagFont = {
  /** CSS font-family list, the Google font first. */
  family: string;
  weight: number;
  /** Google Fonts stylesheets to load. */
  hrefs: string[];
};

/** The Google Fonts stylesheet for a family, at one weight or its default. */
export const googleFontHref = (family: string, weight?: number) =>
  `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}${
    weight ? `:wght@${weight}` : ''
  }&display=swap`;

/**
 * Any Google Fonts family by name (`font=Bungee`, `font=Baloo+2`), with an
 * optional `weight` of light, medium, bold or black. Without `font`, letters
 * use Poppins bold; a custom font without `weight` uses its regular cut.
 *
 * Google refuses a stylesheet asking for a weight the family lacks, so the
 * regular cut always loads too and the browser falls back to it.
 */
export const parseFont = (
  name: string | null | undefined,
  weight: string | null | undefined
): FlagFont => {
  const trimmed = (name ?? '').trim().replaceAll(/\s+/g, ' ');
  const isCustom = FONT_NAME.test(trimmed);
  const family = isCustom ? trimmed : DEFAULT_FONT;

  const key = (weight ?? '').trim().toLowerCase();
  const named = Object.hasOwn(FONT_WEIGHTS, key)
    ? FONT_WEIGHTS[key as FontWeightName]
    : undefined;
  const chosen = named ?? (isCustom ? undefined : FONT_WEIGHTS[DEFAULT_WEIGHT]);

  return {
    family: `'${family}', ${FALLBACK_FONTS}`,
    weight: chosen ?? 400,
    hrefs: chosen
      ? [googleFontHref(family), googleFontHref(family, chosen)]
      : [googleFontHref(family)],
  };
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
export const splitMessage = (raw = ''): string[][] => {
  // Bound the work to the cap, whatever length the query string arrives at.
  const input = raw.slice(0, MAX_CHARS * 8);
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

const relativeLuminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const c = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

/** WCAG contrast ratio between two colors. */
const contrast = (a: string, b: string): number => {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (lighter + 0.05) / (darker + 0.05);
};

/** Darken a hex color toward black by `amount` (0 to 1). */
const shade = (hex: string, amount: number): string => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) =>
    Math.round(
      Number.parseInt(value.slice(offset, offset + 2), 16) * (1 - amount)
    )
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

/** Flag body height (below the cord) as a multiple of its width. */
const BODY: Record<FlagStyle, number> = {
  mono: 1.2,
  duo: 1.2,
  circle: 1,
};

/** The cord each flag hangs from, as a multiple of its width. */
export const CORD = 0.22;

/** How far each string sags at its middle, by number of lines. */
const SAG: Record<number, number> = { 1: 170, 2: 90 };

const ROPE_TOP = 24;
const LINE_GAP = 48;
const BOTTOM_PAD = 24;
const MAX_FLAG_WIDTH = 130;
/** Flags hang between these fractions of the string's width. */
export const SPAN_START = 0.06;
const SPAN_END = 0.94;
/** A flag's width as a share of its slot; the rest is the gap between. */
const FILL = 0.86;
/** A space takes this share of a slot. */
const SPACE_SLOT = 0.55;

export type PlacedFlag = {
  key: string;
  char: string;
  /** Where the flag's cord ties onto the string. */
  x: number;
  y: number;
  fill: string;
  accent: string;
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
  /** Cord plus body. */
  flagHeight: number;
  cordLength: number;
  ropes: Rope[];
  flags: PlacedFlag[];
  rope: string;
  text: string;
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

/** How many flag slots a line needs; a space takes a narrower slot. */
const slotsFor = (line: string[]) =>
  line.reduce((total, char) => total + (char === ' ' ? SPACE_SLOT : 1), 0);

export const layoutFlags = (
  lines: string[][],
  theme: FlagTheme,
  style: FlagStyle
): FlagLayout => {
  const sag = SAG[lines.length] ?? SAG[2];

  // Both lines share one flag size, set by whichever line needs the most room.
  const maxSlots = Math.max(1, ...lines.map((line) => slotsFor(line)));
  const span = (SPAN_END - SPAN_START) * VIEW_WIDTH;
  const slot = Math.min(span / maxSlots, MAX_FLAG_WIDTH / FILL);
  const flagWidth = slot * FILL;
  const cordLength = flagWidth * CORD;
  const flagHeight = cordLength + flagWidth * BODY[style];

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
      const accents = theme.accents ?? [
        ...theme.fills.slice(1),
        theme.fills[0],
      ];
      const accent = accents[colorIndex % accents.length];
      flags.push({
        key: `${lineIndex}-${charIndex}`,
        char,
        x,
        y: ropeY(top, sag, x),
        fill,
        accent,
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
    cordLength,
    ropes,
    flags,
    rope: theme.rope,
    text: TEXT_COLORS[theme.text],
  };
};
