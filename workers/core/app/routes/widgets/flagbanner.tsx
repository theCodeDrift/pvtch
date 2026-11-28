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
import {
  DEFAULT_FONT,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  FLAG_STYLES,
  MAX_CHARS,
  SUGGESTED_FONTS,
  THEME_NAMES,
  THEMES,
  splitMessage,
  type FlagStyle,
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
  const [weight, setWeight] = useState(`${DEFAULT_FONT_WEIGHT}`);

  const flagCount = useMemo(
    () => splitMessage(message).flat().length,
    [message]
  );
  const customColors = useMemo(() => parseColors(colors), [colors]);

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
    const trimmedFont = font.trim();
    const isDefaultFont = !trimmedFont || trimmedFont === DEFAULT_FONT;
    if (!isDefaultFont) params.set('font', trimmedFont);
    const isDefaultWeight = weight === `${DEFAULT_FONT_WEIGHT}`;
    if (weight && (!isDefaultFont || !isDefaultWeight)) {
      params.set('weight', weight);
    }
    return params.toString();
  }, [message, theme, customColors, style, font, weight]);

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

      {/* Live Preview */}
      {previewSrc && (
        <div className="sticky top-16 z-10 bg-background py-2 not-prose">
          <div className="relative w-full aspect-video rounded overflow-hidden border bg-zinc-800">
            <iframe
              key={previewSrc}
              src={previewSrc}
              className="w-full h-full border-0"
              title="Flag Banner Preview"
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 pt-4 not-prose">
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
            Up to {MAX_CHARS} characters ({flagCount} used). Type <code>/</code>{' '}
            where the second line should start; otherwise longer messages break
            at the most even space.
          </FieldDescription>
        </Field>

        <h2 className="text-xl font-semibold mt-2">Colors</h2>
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

        <h2 className="text-xl font-semibold mt-2">Flags</h2>
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

        <div className="grid grid-cols-[1fr_8rem] gap-4">
          <Field>
            <FieldLabel htmlFor="font">Google font</FieldLabel>
            <Input
              id="font"
              list="flagbanner-fonts"
              autoComplete="off"
              placeholder={DEFAULT_FONT}
              value={font}
              onChange={(event) => {
                const next = event.target.value;
                setFont(next);
                // other families may lack Fredoka's 600 cut; start them regular
                setWeight(
                  next.trim() === DEFAULT_FONT ? `${DEFAULT_FONT_WEIGHT}` : ''
                );
              }}
            />
            <datalist id="flagbanner-fonts">
              {SUGGESTED_FONTS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <FieldDescription>
              Pick a suggestion or type any family name from{' '}
              <a
                href="https://fonts.google.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Google Fonts
              </a>
              .
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="weight">Weight</FieldLabel>
            <Input
              id="weight"
              type="number"
              min={100}
              max={900}
              step={100}
              autoComplete="off"
              placeholder="400"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
            <FieldDescription>Blank for regular</FieldDescription>
          </Field>
        </div>
      </div>

      {/* OBS URL */}
      <div className="mt-8 space-y-4 not-prose">
        <h2 className="text-xl font-semibold">Your OBS URL</h2>
        <div className="flex flex-row gap-2">
          <Input readOnly value={obsUrl} className="font-mono" />
          <Button type="button" variant="default" onClick={copyUrl}>
            <Copy className="h-4 w-4" />
          </Button>
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
              A font weight the family doesn&apos;t have falls back to a system
              font. Check the preview.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
