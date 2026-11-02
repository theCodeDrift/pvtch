import { useState, useMemo, useEffect, useRef } from 'react';
import { useLoaderData, data, redirect } from 'react-router';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { RgbaStringColorPicker } from 'react-colorful';
import type { Route } from './+types/1s';
import { instanceAccessContext, userContext } from '@/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';

const DEFAULTS = {
  bg: 'rgb(34, 34, 34)',
  bar: 'rgb(216, 228, 103)',
  text: 'white',
  duration: 60,
  cooldown: 30,
  repeat: false,
  choices: '',
};

function ColorSwatch({
  color,
  onChange,
  label,
}: {
  color: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
        className="flex items-center gap-2 rounded-md border px-3 py-2 not-prose"
      >
        <div
          className="h-5 w-5 rounded-sm border"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm">{label}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 rounded-lg border bg-background p-3 shadow-lg not-prose">
          <RgbaStringColorPicker color={color} onChange={onChange} />
          <Input
            className="mt-2 font-mono text-xs"
            value={color}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: '1s in Chat - Quick Polling for OBS & Twitch Streams - PVTCH' },
    {
      name: 'description',
      content:
        'Create real-time chat polls for your Twitch stream. Viewers type their vote in chat and results display as animated bar charts in your OBS overlay. Free and self-hostable.',
    },
    {
      property: 'og:title',
      content: '1s in Chat - Quick Polling for OBS & Twitch Streams',
    },
    {
      property: 'og:description',
      content:
        'Create real-time chat polls for your Twitch stream. Viewers vote in chat, results display as animated bar charts.',
    },
  ];
}

export function loader({ context }: Route.LoaderArgs) {
  const access = context.get(instanceAccessContext);
  if (access?.isPrivate && !access?.isAllowed) {
    return redirect('/private');
  }

  const user = context.get(userContext);
  if (!user) {
    return data({ authenticated: false as const, channel: '' });
  }

  return data({
    authenticated: true as const,
    channel: user.login,
  });
}

export default function Widgets1s() {
  const loaderData = useLoaderData<typeof loader>();

  const [channel, setChannel] = useState(loaderData.channel);
  const [bg, setBg] = useState(DEFAULTS.bg);
  const [text, setText] = useState(DEFAULTS.text);
  const [bar, setBar] = useState(DEFAULTS.bar);
  const [duration, setDuration] = useState(DEFAULTS.duration);
  const [cooldown, setCooldown] = useState(DEFAULTS.cooldown);
  const [repeat, setRepeat] = useState(DEFAULTS.repeat);
  const [useChoices, setUseChoices] = useState(false);
  const [choices, setChoices] = useState(DEFAULTS.choices);

  // Build OBS URL with only non-default params
  const obsUrl = useMemo(() => {
    if (!channel || globalThis.window === undefined) return '';

    const params = new URLSearchParams();
    if (bg !== DEFAULTS.bg) params.set('bg', bg);
    if (text !== DEFAULTS.text) params.set('text', text);
    if (bar !== DEFAULTS.bar) params.set('bar', bar);
    if (duration !== DEFAULTS.duration) params.set('duration', `${duration}`);
    if (cooldown !== DEFAULTS.cooldown) params.set('cooldown', `${cooldown}`);
    if (repeat !== DEFAULTS.repeat) params.set('repeat', `${repeat}`);
    if (useChoices && choices.trim()) params.set('choices', choices.trim());

    const qs = params.toString();
    return `${globalThis.location.origin}/sources/1s/${channel}${qs ? `?${qs}` : ''}`;
  }, [channel, bg, text, bar, duration, cooldown, repeat, useChoices, choices]);

  // Build demo iframe URL (always includes demo=true)
  const [debouncedIframeSrc, setDebouncedIframeSrc] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const iframeSrc = useMemo(() => {
    if (!channel || globalThis.window === undefined) return '';

    const params = new URLSearchParams();
    params.set('demo', 'true');
    if (bg !== DEFAULTS.bg) params.set('bg', bg);
    if (text !== DEFAULTS.text) params.set('text', text);
    if (bar !== DEFAULTS.bar) params.set('bar', bar);
    if (useChoices && choices.trim()) params.set('choices', choices.trim());

    return `${globalThis.location.origin}/sources/1s/${channel}?${params.toString()}`;
  }, [channel, bg, text, bar, useChoices, choices]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedIframeSrc(iframeSrc);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [iframeSrc]);

  const copyUrl = () => {
    if (!obsUrl) return;
    void navigator.clipboard.writeText(obsUrl);
    toast.success('OBS URL copied to clipboard!');
  };

  return (
    <div className="prose dark:prose-invert max-w-none">
      <h1>1s in Chat</h1>
      <p className="text-muted-foreground">
        Real-time chat voting overlay for OBS. Viewers type their vote in chat
        and results display as animated bar charts.
      </p>

      {/* Live Preview */}
      {channel && debouncedIframeSrc && (
        <div className="sticky top-16 z-10 bg-background py-2 not-prose">
          <div
            className="relative w-full rounded overflow-hidden border"
            style={{ height: '200px' }}
          >
            <iframe
              key={debouncedIframeSrc}
              src={debouncedIframeSrc}
              className="w-full h-full border-0"
              title="1s in Chat Preview"
            />
          </div>
        </div>
      )}

      {/* Form */}
      <div className="flex flex-col gap-6 pt-4 not-prose">
        {/* Channel Name */}
        <Field>
          <FieldLabel htmlFor="channel">Twitch Channel</FieldLabel>
          <Input
            id="channel"
            autoComplete="off"
            placeholder="your_channel_name"
            value={channel}
            onChange={(e) => setChannel(e.target.value.toLowerCase().trim())}
          />
          <FieldDescription>
            {loaderData.authenticated
              ? 'Auto-filled from your Twitch login. You can change it if needed.'
              : 'Enter your Twitch channel name.'}
          </FieldDescription>
        </Field>

        {/* Appearance */}
        <h2 className="text-xl font-semibold mt-2">Appearance</h2>

        <div className="flex flex-wrap gap-4">
          <ColorSwatch color={bg} onChange={setBg} label="Background" />
          <ColorSwatch color={text} onChange={setText} label="Text" />
          <ColorSwatch color={bar} onChange={setBar} label="Bar" />
        </div>

        {/* Timing */}
        <h2 className="text-xl font-semibold mt-2">Timing</h2>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="duration">Vote Duration (seconds)</FieldLabel>
            <Input
              id="duration"
              type="number"
              autoComplete="off"
              placeholder={`${DEFAULTS.duration}`}
              value={duration}
              onChange={(e) =>
                setDuration(
                  Math.max(
                    1,
                    Number.parseInt(e.target.value, 10) || DEFAULTS.duration
                  )
                )
              }
            />
            <FieldDescription>
              How long the voting window stays open
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="cooldown">Cooldown (seconds)</FieldLabel>
            <Input
              id="cooldown"
              type="number"
              autoComplete="off"
              placeholder={`${DEFAULTS.cooldown}`}
              value={cooldown}
              onChange={(e) =>
                setCooldown(
                  Math.max(
                    1,
                    Number.parseInt(e.target.value, 10) || DEFAULTS.cooldown
                  )
                )
              }
            />
            <FieldDescription>
              How long results stay visible after voting ends
            </FieldDescription>
          </Field>
        </div>

        {/* Voting */}
        <h2 className="text-xl font-semibold mt-2">Voting</h2>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Allow Repeat Votes</div>
            <FieldDescription>
              Let viewers vote repeatedly by spamming their vote
            </FieldDescription>
          </div>
          <Switch checked={repeat} onCheckedChange={setRepeat} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable Named Choices</div>
            <FieldDescription>
              Use named options instead of numeric voting (1, 2, 3...)
            </FieldDescription>
          </div>
          <Switch checked={useChoices} onCheckedChange={setUseChoices} />
        </div>

        {useChoices && (
          <Field>
            <FieldLabel htmlFor="choices">Choices</FieldLabel>
            <Input
              id="choices"
              autoComplete="off"
              placeholder="pizza, tacos, sushi"
              value={choices}
              onChange={(e) => setChoices(e.target.value)}
            />
            <FieldDescription>
              Comma-separated list of valid vote options
            </FieldDescription>
          </Field>
        )}
      </div>

      {/* OBS URL */}
      <div className="mt-8 space-y-4 not-prose">
        <h2 className="text-xl font-semibold">Your OBS URL</h2>
        {channel ? (
          <div className="flex flex-row gap-2">
            <Input readOnly value={obsUrl} className="font-mono" />
            <Button type="button" variant="default" onClick={copyUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Enter a channel name above to generate your URL.
          </p>
        )}
      </div>

      {/* How to Use Guide */}
      <div className="mt-10 space-y-6">
        <h2>How to Use</h2>

        <div>
          <h3>1. Add to OBS</h3>
          <p className="text-muted-foreground">
            In OBS, add a <strong>Browser Source</strong> and paste the URL
            above. Recommended size: 500 &times; 250. Fonts scale relative to
            your browser source&apos;s height.
          </p>
        </div>

        <div>
          <h3>2. How Viewers Vote</h3>
          <p className="text-muted-foreground">
            Viewers type a number in chat to vote (1, 2, 3...). Meme formats
            work too. &quot;1111111&quot; counts as a vote for 1. If you set
            choices above, viewers type the choice name instead. Voting starts
            automatically when the first vote comes in.
          </p>
        </div>

        <div>
          <h3>3. Mod Commands</h3>
          <div className="text-muted-foreground space-y-1">
            <div>
              <strong>!1s timer 45/10</strong> Set 45s vote window, 10s cooldown
            </div>
            <div>
              <strong>!1s vote one</strong> One vote per person
            </div>
            <div>
              <strong>!1s vote many</strong> Allow repeat voting
            </div>
            <div>
              <strong>!1s list a, b, c</strong> Set named choices
            </div>
            <div>
              <strong>!1s list</strong> Clear choices (back to numbers)
            </div>
            <div>
              <strong>!1s reset</strong> Clear all votes
            </div>
          </div>
          <p className="text-muted-foreground mt-1">
            All commands reset the current vote and are restricted to mods and
            the broadcaster.
          </p>
        </div>

        <div>
          <h3>4. Tips</h3>
          <ul className="text-muted-foreground list-disc ml-4 space-y-1">
            <li>
              30&ndash;60 seconds is a good voting window for most audiences
            </li>
            <li>
              The top 4 options are shown. The rest are tallied but hidden
            </li>
            <li>
              The overlay auto-starts when the first vote comes in, no manual
              trigger needed
            </li>
            <li>
              To resize, set new height and width in the browser source
              properties. Dragging and resizing inside OBS stretches pixels like
              an image, resulting in fuzzy text. Change the height/width and
              you&apos;ll get a beautiful widget every time.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
