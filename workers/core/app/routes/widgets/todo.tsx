import { useState, useMemo, useEffect, useRef } from 'react';
import { useLoaderData, data, redirect } from 'react-router';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { RgbaStringColorPicker } from 'react-colorful';
import type { Route } from './+types/todo';
import { instanceAccessContext, userContext } from '@/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';

const DEFAULTS = {
  bg: 'rgba(34, 34, 34, 0.8)',
  fg: 'white',
  help: true,
  count: 5,
  add: 'add',
  done: 'done',
  focus: 'focus',
  reset: 'reset',
  clear: 'clear',
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
    {
      title:
        'Chat Tasks - Collaborative Task List for OBS & Twitch Streams - PVTCH',
    },
    {
      name: 'description',
      content:
        'Add a collaborative task list overlay to your Twitch stream. Viewers add and complete tasks via chat commands. Free and self-hostable.',
    },
    {
      property: 'og:title',
      content: 'Chat Tasks - Collaborative Task List for OBS & Twitch Streams',
    },
    {
      property: 'og:description',
      content:
        'Collaborative task list overlay for Twitch streams. Viewers manage tasks via chat commands.',
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

export default function TodoWidget() {
  const loaderData = useLoaderData<typeof loader>();

  const [channel, setChannel] = useState(loaderData.channel);
  const [bg, setBg] = useState(DEFAULTS.bg);
  const [fg, setFg] = useState(DEFAULTS.fg);
  const [help, setHelp] = useState(DEFAULTS.help);
  const [count, setCount] = useState(DEFAULTS.count);
  const [add, setAdd] = useState(DEFAULTS.add);
  const [done, setDone] = useState(DEFAULTS.done);
  const [focus, setFocus] = useState(DEFAULTS.focus);
  const [showModCommands, setShowModCommands] = useState(false);
  const [reset, setReset] = useState(DEFAULTS.reset);
  const [clear, setClear] = useState(DEFAULTS.clear);

  // Build OBS URL with only non-default params
  const obsUrl = useMemo(() => {
    if (!channel || globalThis.window === undefined) return '';

    const params = new URLSearchParams();
    if (bg !== DEFAULTS.bg) params.set('bg', bg);
    if (fg !== DEFAULTS.fg) params.set('fg', fg);
    if (help !== DEFAULTS.help) params.set('help', `${help}`);
    if (count !== DEFAULTS.count) params.set('count', `${count}`);
    if (add !== DEFAULTS.add) params.set('add', add);
    if (done !== DEFAULTS.done) params.set('done', done);
    if (focus !== DEFAULTS.focus) params.set('focus', focus);
    if (reset !== DEFAULTS.reset) params.set('reset', reset);
    if (clear !== DEFAULTS.clear) params.set('clear', clear);

    const qs = params.toString();
    return `${globalThis.location.origin}/sources/todo/${channel}${qs ? `?${qs}` : ''}`;
  }, [channel, bg, fg, help, count, add, done, focus, reset, clear]);

  // Build demo iframe URL
  const [debouncedIframeSrc, setDebouncedIframeSrc] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const iframeSrc = useMemo(() => {
    if (!channel || globalThis.window === undefined) return '';

    const params = new URLSearchParams();
    params.set('demo', 'true');
    if (bg !== DEFAULTS.bg) params.set('bg', bg);
    if (fg !== DEFAULTS.fg) params.set('fg', fg);
    if (help !== DEFAULTS.help) params.set('help', `${help}`);
    if (add !== DEFAULTS.add) params.set('add', add);
    if (done !== DEFAULTS.done) params.set('done', done);
    if (focus !== DEFAULTS.focus) params.set('focus', focus);

    return `${globalThis.location.origin}/sources/todo/${channel}?${params.toString()}`;
  }, [channel, bg, fg, help, add, done, focus]);

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
      <h1>Chat Tasks</h1>
      <p className="text-muted-foreground">
        Collaborative task list overlay for your stream. Viewers add and
        complete tasks via chat commands.
      </p>

      {/* Two-column layout: config left, preview right */}
      <div className="flex flex-col md:flex-row gap-8 not-prose">
        {/* Left: Config */}
        <div className="flex flex-col gap-6 md:w-1/2">
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
            <ColorSwatch color={fg} onChange={setFg} label="Text" />
          </div>

          {/* Behavior */}
          <h2 className="text-xl font-semibold mt-2">Behavior</h2>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Show Help Header</div>
              <FieldDescription>
                Display command names (!{add} &middot; !{done} &middot; !{focus}
                ) at the top
              </FieldDescription>
            </div>
            <Switch checked={help} onCheckedChange={setHelp} />
          </div>

          <Field>
            <FieldLabel htmlFor="count">Max Tasks per User</FieldLabel>
            <Input
              id="count"
              type="number"
              autoComplete="off"
              placeholder={`${DEFAULTS.count}`}
              value={count}
              onChange={(e) =>
                setCount(
                  Math.max(
                    1,
                    Number.parseInt(e.target.value, 10) || DEFAULTS.count
                  )
                )
              }
            />
            <FieldDescription>
              Maximum number of incomplete tasks each viewer can have
            </FieldDescription>
          </Field>

          {/* Command Names */}
          <h2 className="text-xl font-semibold mt-2">Command Names</h2>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="cmd-add">Add</FieldLabel>
              <Input
                id="cmd-add"
                autoComplete="off"
                placeholder={DEFAULTS.add}
                value={add}
                onChange={(e) => setAdd(e.target.value.trim())}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="cmd-done">Done</FieldLabel>
              <Input
                id="cmd-done"
                autoComplete="off"
                placeholder={DEFAULTS.done}
                value={done}
                onChange={(e) => setDone(e.target.value.trim())}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="cmd-focus">Focus</FieldLabel>
              <Input
                id="cmd-focus"
                autoComplete="off"
                placeholder={DEFAULTS.focus}
                value={focus}
                onChange={(e) => setFocus(e.target.value.trim())}
              />
            </Field>
          </div>

          {/* Mod Commands */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Change mod commands</div>
              <FieldDescription>
                Customize the reset and clear command names
              </FieldDescription>
            </div>
            <Switch
              checked={showModCommands}
              onCheckedChange={setShowModCommands}
            />
          </div>

          {showModCommands && (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="cmd-reset">Reset</FieldLabel>
                <Input
                  id="cmd-reset"
                  autoComplete="off"
                  placeholder={DEFAULTS.reset}
                  value={reset}
                  onChange={(e) => setReset(e.target.value.trim())}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="cmd-clear">Clear</FieldLabel>
                <Input
                  id="cmd-clear"
                  autoComplete="off"
                  placeholder={DEFAULTS.clear}
                  value={clear}
                  onChange={(e) => setClear(e.target.value.trim())}
                />
              </Field>
            </div>
          )}
        </div>

        {/* Right: Preview + OBS URL */}
        <div className="md:w-1/2">
          <div className="sticky top-16">
            {channel && debouncedIframeSrc && (
              <div
                className="relative w-full rounded overflow-hidden border"
                style={{ height: '400px' }}
              >
                <iframe
                  key={debouncedIframeSrc}
                  src={debouncedIframeSrc}
                  className="w-full h-full border-0"
                  title="Chat Tasks Preview"
                />
              </div>
            )}

            {/* OBS URL */}
            <div className="mt-4 space-y-2">
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
                  Enter a channel name to generate your URL.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* How to Use Guide - full width */}
      <div className="mt-10 space-y-6">
        <h2>How to Use</h2>

        <div>
          <h3>1. Add to OBS</h3>
          <p className="text-muted-foreground">
            In OBS, add a <strong>Browser Source</strong> and paste the URL
            above. Recommended size: 400 &times; 600. Fonts scale relative to
            your browser source&apos;s height. To resize, set new height and
            width in the browser source properties. Dragging and resizing inside
            OBS stretches pixels like an image, resulting in fuzzy text.
          </p>
        </div>

        <div>
          <h3>2. For Chat</h3>
          <div className="text-muted-foreground space-y-1">
            <div>
              <strong>!{add} Fix the bug</strong> Add a task
            </div>
            <div>
              <strong>!{add} Fix bug; Write tests</strong> Add multiple tasks
              (separated by semicolons)
            </div>
            <div>
              <strong>!{done}</strong> Complete your first incomplete task
            </div>
            <div>
              <strong>!{done} 2</strong> Complete task #2
            </div>
            <div>
              <strong>!{done} 1;3</strong> Complete tasks #1 and #3
            </div>
            <div>
              <strong>!{focus} 2</strong> Highlight task #2 (bumps it higher in
              your list)
            </div>
          </div>
        </div>

        <div>
          <h3>3. For Streamers &amp; Mods</h3>
          <div className="text-muted-foreground space-y-1">
            <div>
              <strong>!{reset}</strong> Clear all tasks
            </div>
            <div>
              <strong>!{reset} @username</strong> Clear one user&apos;s tasks
            </div>
            <div>
              <strong>!{clear}</strong> Remove completed tasks only
            </div>
          </div>
          <p className="text-muted-foreground mt-1">
            These commands are restricted to moderators and the broadcaster.
          </p>
        </div>

        <div>
          <h3>4. Tips</h3>
          <ul className="text-muted-foreground list-disc ml-4 space-y-1">
            <li>
              {count} tasks per user is the default limit. Adjust it above if
              needed
            </li>
            <li>
              Tasks persist in the browser (localStorage) and survive page
              reloads
            </li>
            <li>The streamer&apos;s tasks always appear first in the list</li>
            <li>The list auto-scrolls when it overflows the widget height</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
