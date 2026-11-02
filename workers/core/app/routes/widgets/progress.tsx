import { useState, useMemo, useEffect, useRef } from 'react';
import { useLoaderData, data, redirect } from 'react-router';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { RgbaStringColorPicker } from 'react-colorful';
import type { Route } from './+types/progress';
import { instanceAccessContext, userContext } from '@/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { BasicBar } from '@/components/progress-bar';
import { AuthGate } from '@/components/auth-gate';
import { DEFAULTS } from '@/routes/sources/progress.$token.$name';

function ColorPicker({
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
    { title: 'Progress Bar Widget for OBS & Twitch Streams - PVTCH' },
    {
      name: 'description',
      content:
        'Create customizable progress bars for your Twitch stream. Track sub goals, donations, or any metric with real-time OBS browser source overlays. Free and self-hostable.',
    },
    {
      property: 'og:title',
      content: 'Progress Bar Widget for OBS & Twitch Streams',
    },
    {
      property: 'og:description',
      content:
        'Create customizable progress bars for your Twitch stream. Track sub goals, donations, or any metric with real-time OBS overlays.',
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
    return data({ authenticated: false as const });
  }

  return data({
    authenticated: true as const,
    token: user.token,
  });
}

export default function WidgetsProgress() {
  const loaderData = useLoaderData<typeof loader>();

  const [id, setId] = useState('default');
  const [fg1, setFg1] = useState(DEFAULTS.fg1);
  const [fg2, setFg2] = useState(DEFAULTS.fg2);
  const [bg, setBg] = useState(DEFAULTS.bg);
  const [goal, setGoal] = useState(DEFAULTS.goal);
  const [text, setText] = useState(DEFAULTS.text);
  const [decimal, setDecimal] = useState(DEFAULTS.decimal);
  const [prefix, setPrefix] = useState(DEFAULTS.prefix);

  // Build OBS URL with only non-default params
  const obsUrl = useMemo(() => {
    if (!loaderData.authenticated || globalThis.window === undefined) return '';

    const params = new URLSearchParams();
    if (fg1 !== DEFAULTS.fg1) params.set('fg1', fg1);
    if (fg2 !== DEFAULTS.fg2) params.set('fg2', fg2);
    if (bg !== DEFAULTS.bg) params.set('bg', bg);
    if (goal !== DEFAULTS.goal) params.set('goal', `${goal}`);
    if (text !== DEFAULTS.text) params.set('text', text);
    if (decimal !== DEFAULTS.decimal) params.set('decimal', `${decimal}`);
    if (prefix !== DEFAULTS.prefix) params.set('prefix', prefix);

    const qs = params.toString();
    return `${globalThis.location.origin}/sources/progress/${loaderData.token}/${id}${qs ? `?${qs}` : ''}`;
  }, [loaderData, id, fg1, fg2, bg, goal, text, decimal, prefix]);

  const updateUrl = useMemo(() => {
    if (!loaderData.authenticated || globalThis.window === undefined) return '';
    return `${globalThis.location.origin}/progress/${loaderData.token}/${id}/set?value=UPDATEME`;
  }, [loaderData, id]);

  const copyUrl = () => {
    if (!obsUrl) return;
    void navigator.clipboard.writeText(obsUrl);
    toast.success('OBS URL copied to clipboard!');
  };

  return (
    <div className="prose dark:prose-invert max-w-none">
      <h1>Progress Bar</h1>

      {/* Auth notice at top when not logged in */}
      {!loaderData.authenticated && (
        <div className="not-prose mb-6">
          <AuthGate
            authenticated={false}
            reason={
              <>
                <span className="font-semibold text-foreground">
                  Requires login
                </span>{' '}
                . Feel free to play around with the widget below. To use it on
                your stream, you&apos;ll need to log in so we can generate your
                unique OBS and API URLs.
              </>
            }
          >
            <></>
          </AuthGate>
        </div>
      )}

      {/* Live Preview (sticky) */}
      <div className="sticky top-16 z-10 bg-background py-2 not-prose">
        <div className="relative h-12 w-full rounded overflow-hidden">
          <BasicBar
            bg={bg}
            fg1={fg1}
            fg2={fg2}
            goal={goal}
            text={text}
            decimal={decimal}
            prefix={prefix}
            progress={64}
            embedded
          />
        </div>
      </div>

      {/* Form Fields */}
      <div className="flex flex-col gap-6 pt-4 not-prose">
        {/* Progress ID */}
        <Field>
          <FieldLabel htmlFor="progress-id">Progress Name</FieldLabel>
          <Input
            id="progress-id"
            autoComplete="off"
            placeholder="default"
            value={id}
            onChange={(e) => setId(e.target.value.trim() || 'default')}
          />
          <FieldDescription>
            A unique name for this progress bar (used in the URL)
          </FieldDescription>
        </Field>

        {/* Colors */}
        <div className="flex flex-wrap gap-4">
          <ColorPicker color={bg} onChange={setBg} label="Background" />
          <ColorPicker color={fg1} onChange={setFg1} label="Fill 1" />
          <ColorPicker color={fg2} onChange={setFg2} label="Fill 2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="goal">Goal Amount</FieldLabel>
            <Input
              id="goal"
              type="number"
              autoComplete="off"
              placeholder="100"
              value={goal}
              onChange={(e) =>
                setGoal(Number.parseInt(e.target.value, 10) || DEFAULTS.goal)
              }
            />
            <FieldDescription>Your arbitrary goal amount</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="decimal">Decimal Places</FieldLabel>
            <Input
              id="decimal"
              type="number"
              autoComplete="off"
              placeholder="0"
              value={decimal}
              onChange={(e) =>
                setDecimal(
                  Number.parseInt(e.target.value, 10) || DEFAULTS.decimal
                )
              }
            />
            <FieldDescription>Round progress to N places</FieldDescription>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="text">Goal Text</FieldLabel>
            <Input
              id="text"
              autoComplete="off"
              placeholder="My Goal Name"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <FieldDescription>Name your goal</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="prefix">Prefix</FieldLabel>
            <Input
              id="prefix"
              autoComplete="off"
              placeholder="$"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <FieldDescription>e.g. "$" or "Level "</FieldDescription>
          </Field>
        </div>
      </div>

      {/* URLs Section - only visible when logged in */}
      {loaderData.authenticated && (
        <div className="mt-8 space-y-4 not-prose">
          <Field>
            <FieldLabel>OBS Browser Source URL</FieldLabel>
            <div className="flex flex-row gap-2">
              <Input type="password" readOnly value={obsUrl} />
              <Button type="button" variant="default" onClick={copyUrl}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel>Update API URL</FieldLabel>
            <div className="flex flex-row gap-2">
              <Input type="password" readOnly value={updateUrl} />
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  void navigator.clipboard.writeText(updateUrl);
                  toast.success('Update API URL copied to clipboard!');
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </Field>
        </div>
      )}

      {/* How to Use Guide */}
      <div className="mt-10 space-y-6">
        <h2>How to Use</h2>

        <div>
          <h3>1. Add to OBS</h3>
          <p className="text-muted-foreground">
            In OBS, add a <strong>Browser Source</strong> and paste the OBS URL
            above. The bar automatically scales its text up or down to fit your
            source size, so pick whatever dimensions work for your layout.
          </p>
        </div>

        <div>
          <h3>2. Update Progress</h3>
          <p className="text-muted-foreground">
            Use the Update API URL to set the current progress value. Replace{' '}
            <code>UPDATEME</code> with a number and hit the URL from your bot,
            StreamerBot, MixItUp, Firebot, or any tool that can make HTTP
            requests. Think of this widget as a progress{' '}
            <strong>displayer</strong>. Keep the value in whatever system makes
            sense for you.
          </p>
        </div>

        <div>
          <h3>3. Tips</h3>
          <ul className="text-muted-foreground list-disc ml-4 space-y-1">
            <li>
              Use two slightly different fill colors for a gradient effect on
              the completed portion of the bar
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
