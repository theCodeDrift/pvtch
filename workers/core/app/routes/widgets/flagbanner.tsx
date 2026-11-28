import { useEffect, useMemo, useRef, useState } from 'react';
import { data, redirect } from 'react-router';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import type { Route } from './+types/flagbanner';
import { instanceAccessContext } from '@/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { FontPicker, weightsFor } from '@/components/font-picker';
import {
  DEFAULT_FONT,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  DEFAULT_WEIGHT,
  FLAG_STYLES,
  FONT_WEIGHT_NAMES,
  FONT_WEIGHTS,
  MAX_CHARS,
  THEME_NAMES,
  THEMES,
  splitMessage,
  type FlagStyle,
  type FontWeightName,
} from '@/lib/flagbanner';

const CUSTOM = 'custom';
const DEFAULT_MESSAGE = 'Happy Birthday';
const DEFAULT_COLOR = '#ff00ff';

const THEME_LABELS: Record<string, string> = {
  'birthday-dark': 'Birthday (dark)',
  'birthday-light': 'Birthday (light)',
  'anniversary-gold': 'Anniversary (gold)',
  'anniversary-silver': 'Anniversary (silver)',
  pastel: 'Pastel',
};

const STYLE_LABELS: Record<FlagStyle, string> = {
  mono: 'Pennant',
  duo: 'Swallowtail',
  circle: 'Circle',
};

const WEIGHT_LABELS: Record<FontWeightName, string> = {
  light: 'Light',
  medium: 'Medium',
  bold: 'Bold',
  black: 'Black',
};

/** The offered weight closest to the one asked for. */
const nearestWeight = (
  wanted: FontWeightName,
  offered: FontWeightName[]
): FontWeightName | undefined =>
  [...offered].sort(
    (a, b) =>
      Math.abs(FONT_WEIGHTS[a] - FONT_WEIGHTS[wanted]) -
      Math.abs(FONT_WEIGHTS[b] - FONT_WEIGHTS[wanted])
  )[0];

const HEX_CODE = /^#?([\da-f]{3}|[\da-f]{6})$/i;

/** "#ff00ff, 0af" → ["ff00ff", "0af"]; undefined if any code is invalid. */
const parseColors = (input: string): string[] | undefined => {
  const codes = input
    .split(/[\s,]+/)
    .map((code) => code.trim())
    .filter(Boolean);
  if (codes.length === 0) return;
  const parsed = codes.map((code) => HEX_CODE.exec(code)?.[1]?.toLowerCase());
  if (parsed.some((code) => !code)) return;
  return parsed as string[];
};

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Flag Banner - Celebration Bunting for OBS - PVTCH' },
    {
      name: 'description',
      content:
        'Hang a birthday, anniversary or any message across your stream as bunting, one letter per flag. Free and self-hostable.',
    },
  ];
}

export function loader({ context }: Route.LoaderArgs) {
  const access = context.get(instanceAccessContext);
  if (access?.isPrivate && !access?.isAllowed) {
    return redirect('/private');
  }
  return data({});
}

function ColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="h-9 w-9 rounded-md border"
        style={{ backgroundColor: color }}
        aria-label="Pick a color"
      />
      {open && (
        <div className="absolute z-20 mt-2 rounded-lg border bg-background p-3 shadow-lg">
          <HexColorPicker color={color} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export default function WidgetsFlagBanner() {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [colors, setColors] = useState(DEFAULT_COLOR);
  const [style, setStyle] = useState<FlagStyle>(DEFAULT_STYLE);
  const [font, setFont] = useState(DEFAULT_FONT);
  const [weight, setWeight] = useState<FontWeightName>(DEFAULT_WEIGHT);

  const flagCount = useMemo(
    () => splitMessage(message).flat().length,
    [message]
  );
  const customColors = useMemo(() => parseColors(colors), [colors]);

  // Offer only the weights the family ships (all four for a typed-in family
  // we don't know), and keep the streamer's pick when the font changes.
  const offeredWeights = useMemo(() => {
    const available = weightsFor(font);
    return FONT_WEIGHT_NAMES.filter(
      (name) => !available || available.includes(FONT_WEIGHTS[name])
    );
  }, [font]);
  const effectiveWeight = offeredWeights.includes(weight)
    ? weight
    : nearestWeight(weight, offeredWeights);

  // Only non-default parameters go in the URL; message always does.
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('message', message);
    if (theme === CUSTOM) {
      if (customColors) params.set('theme', `color-${customColors.join('-')}`);
    } else if (theme !== DEFAULT_THEME) {
      params.set('theme', theme);
    }
    if (style !== DEFAULT_STYLE) params.set('style', style);
    if (font === DEFAULT_FONT) {
      if (effectiveWeight && effectiveWeight !== DEFAULT_WEIGHT) {
        params.set('weight', effectiveWeight);
      }
    } else {
      params.set('font', font);
      // without a weight, a custom font uses its regular cut
      if (effectiveWeight) params.set('weight', effectiveWeight);
    }
    return params.toString();
  }, [message, theme, customColors, style, font, effectiveWeight]);

  const obsUrl =
    globalThis.window === undefined
      ? ''
      : `${globalThis.location.origin}/sources/flagbanner?${query}`;

  const [previewSrc, setPreviewSrc] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewSrc(`/sources/flagbanner?${query}`);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const copyUrl = () => {
    if (!obsUrl) return;
    void navigator.clipboard.writeText(obsUrl);
    toast.success('OBS URL copied to clipboard!');
  };

  return (
    <div className="prose dark:prose-invert max-w-none">
      <h1>Flag Banner</h1>
      <p className="text-muted-foreground">
        Hang a birthday, anniversary or any message across the top of your
        stream as bunting, one letter per flag.
      </p>

      {/* Two-column layout: config left, preview right */}
      <div className="flex flex-col md:flex-row gap-8 not-prose">
        {/* Left: Config */}
        <div className="flex flex-col gap-6 md:w-1/2">
          <Field>
            <FieldLabel htmlFor="message">Message</FieldLabel>
            <Input
              id="message"
              autoComplete="off"
              placeholder={DEFAULT_MESSAGE}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <FieldDescription>
              Up to {MAX_CHARS} characters ({flagCount} used). Type{' '}
              <code>/</code> where the second line should start; otherwise
              longer messages break at the most even space.
            </FieldDescription>
          </Field>

          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">Colors</h2>
            <div className="flex flex-wrap gap-2">
              {THEME_NAMES.map((name) => (
                <Button
                  key={name}
                  type="button"
                  variant={theme === name ? 'default' : 'outline'}
                  onClick={() => setTheme(name)}
                  className="gap-2"
                >
                  <span className="flex">
                    {THEMES[name].fills.slice(0, 4).map((fill) => (
                      <span
                        key={fill}
                        className="h-3 w-3 rounded-full border border-black/10 -ml-1 first:ml-0"
                        style={{ backgroundColor: fill }}
                      />
                    ))}
                  </span>
                  {THEME_LABELS[name] ?? name}
                </Button>
              ))}
              <Button
                type="button"
                variant={theme === CUSTOM ? 'default' : 'outline'}
                onClick={() => setTheme(CUSTOM)}
              >
                Custom color
              </Button>
            </div>

            {theme === CUSTOM && (
              <Field>
                <FieldLabel htmlFor="colors">Hex colors</FieldLabel>
                <div className="flex gap-2">
                  <ColorPicker
                    color={customColors ? `#${customColors[0]}` : DEFAULT_COLOR}
                    onChange={setColors}
                  />
                  <Input
                    id="colors"
                    autoComplete="off"
                    className="font-mono"
                    placeholder="#ff00ff, #00aaff"
                    value={colors}
                    onChange={(event) => setColors(event.target.value)}
                    aria-invalid={!customColors}
                  />
                </div>
                <FieldDescription>
                  {customColors
                    ? 'One color paints every flag. List several to cycle through them. Letters turn light or dark to suit.'
                    : 'Use hex codes like #ff00ff or 0af, separated by commas.'}
                </FieldDescription>
              </Field>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">Flags</h2>
            <div className="flex flex-wrap gap-2">
              {FLAG_STYLES.map((name) => (
                <Button
                  key={name}
                  type="button"
                  variant={style === name ? 'default' : 'outline'}
                  onClick={() => setStyle(name)}
                >
                  {STYLE_LABELS[name]}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">Font</h2>
            <FontPicker value={font} onChange={setFont} />
            {offeredWeights.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {FONT_WEIGHT_NAMES.map((name) => (
                  <Button
                    key={name}
                    type="button"
                    variant={effectiveWeight === name ? 'default' : 'outline'}
                    disabled={!offeredWeights.includes(name)}
                    onClick={() => setWeight(name)}
                  >
                    {WEIGHT_LABELS[name]}
                  </Button>
                ))}
              </div>
            ) : (
              <FieldDescription>{font} comes in one weight.</FieldDescription>
            )}
          </div>
        </div>

        {/* Right: Preview + OBS URL */}
        <div className="md:w-1/2">
          <div className="sticky top-16 flex flex-col gap-4">
            <div>
              <div className="relative w-full aspect-video rounded overflow-hidden border bg-linear-to-br from-zinc-600 via-zinc-800 to-zinc-900">
                {previewSrc && (
                  <iframe
                    key={previewSrc}
                    src={previewSrc}
                    className="absolute inset-0 w-full h-full border-0"
                    title="Flag Banner Preview"
                  />
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                As it hangs on a 1920 &times; 1080 stream.
              </p>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Your OBS URL</h2>
              <div className="flex flex-row gap-2">
                <Input readOnly value={obsUrl} className="font-mono" />
                <Button type="button" variant="default" onClick={copyUrl}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 space-y-6">
        <h2>How to Use</h2>
        <div>
          <h3>1. Add to OBS</h3>
          <p className="text-muted-foreground">
            Add a <strong>Browser Source</strong> with the URL above, sized 1920
            &times; 1080 (or your canvas size). The banner spans the full width
            and hangs from the top; the rest is transparent.
          </p>
        </div>
        <div>
          <h3>2. Change the message</h3>
          <p className="text-muted-foreground">
            Everything lives in the URL. Edit it here, copy the new URL, and
            paste it into the browser source.
          </p>
        </div>
        <div>
          <h3>3. Tips</h3>
          <ul className="text-muted-foreground list-disc ml-4 space-y-1">
            <li>Each emoji gets its own flag.</li>
            <li>
              Any Google font works: search the list or type its exact name.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
