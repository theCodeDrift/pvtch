import type { Route } from './+types/1s.$channel';
import { useLoaderData, data, redirect } from 'react-router';
import { cloudflareEnvironmentContext } from '@/context';
import { useComfy, type ComfyEvents } from '@/hooks/use-comfy';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router';
import z from 'zod';
import { useNoTheme } from '@/hooks/use-no-theme';
import {
  applyVote,
  commandOverrides,
  EMPTY_ROUND,
  isRoundOver,
  votingStateAt,
  type VoteRound,
} from '@/lib/one-second-vote';
import { useDocumentVisibilityState, useIntervalWhen } from 'rooks';
import { Lock, Play, Timer } from 'lucide-react';
import EE from 'eventemitter3';

/*
TODOs
- [x] Repeat voting state on/off
- [x] "Current Config" merging
- [x] !1s mod commands
  - [x] Duration/Cooldown
  - [x] Mode one|many
  - [x] Clear
- [ ] Callback URL trigger

FEATURE CREEP
- [x] Allow non-numeric voting (fixed list, param only, comma separated)
  - [x] Show vote options when enabled (top bar, left side)
*/

const DEFAULTS = {
  bg: 'rgb(34, 34, 34)',
  bar: 'rgb(216, 228, 103)',
  text: 'white',
  duration: 60,
  cooldown: 30,
  repeat: false,
  choices: [],
  callback: undefined,
  demo: false,
} as const;

const parameterParser = z
  .object({
    bg: z.string().optional().default(DEFAULTS.bg),
    text: z.string().optional().default(DEFAULTS.text),
    bar: z.string().optional().default(DEFAULTS.bar),
    duration: z
      .string()
      .optional()
      .default(`${DEFAULTS.duration}`)
      .transform((input) => {
        const value = Number.parseInt(input, 10);
        if (Number.isNaN(value) || value <= 0) {
          return DEFAULTS.duration;
        }
        return value;
      }),
    cooldown: z
      .string()
      .optional()
      .default(`${DEFAULTS.cooldown}`)
      .transform((input) => {
        const value = Number.parseInt(input, 10);
        if (Number.isNaN(value) || value <= 0) {
          return DEFAULTS.cooldown;
        }
        return value;
      }),
    repeat: z
      .string()
      .optional()
      .default('false')
      .transform((input) => {
        return input.toLocaleLowerCase() === 'true';
      }),
    choices: z
      .string()
      .optional()
      .default('')
      .transform((input) => {
        if (!input) {
          return [];
        }
        const options = input
          .split(',')
          .map((s) => s.trim())
          .filter((v) => v && v.length > 0);
        return options.length > 0 ? options : [];
      }),
    callback: z
      .string()
      .optional()
      .transform((input) => {
        // try to parse URL as valid, return undefined if missing or invalid
        if (!input) return;
        try {
          return new URL(input).toString();
        } catch {
          return;
        }
      }),
    demo: z
      .string()
      .optional()
      .default('false')
      .transform((input) => input.toLocaleLowerCase() === 'true'),
  })
  .optional()
  .default({
    ...DEFAULTS,
    choices: [],
  });

// turns 11111111 into "1"
// turns 1.1 into "1"
// normalizes our input numbers, supporting memish format
const numericNormalizer = (input: string) => {
  const trimmed = input.trim();

  // if all the same number, it's just the first number
  if (/^(\d)\1*$/.test(trimmed)) {
    return trimmed[0];
  }

  // if it's a decimal number, take the integer part
  const integerPart = trimmed.split('.')[0];
  if (/^\d+$/.test(integerPart)) {
    return integerPart;
  }

  // if it's just a number, return it
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // otherwise, return nothing
  return;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const nobody = {
  broadcaster: false,
  mod: false,
  founder: false,
  subscriber: false,
  vip: false,
  highlighted: false,
  customReward: false,
};
const fakeflags = {
  id: 'fakeid',
  channel: 'fakechannel',
  roomId: 'fakerroomid',
  messageType: 'chat',
  isEmoteOnly: false,
  userId: 'fakeuserid',
  username: 'fakeusername',
  displayName: 'fakeusername',
  userColor: '#ffffff',
  userBadges: [],
  customRewardId: '',
  flags: [],
  timestamp: `${Date.now()}`,
};

// Loader: fetch url param to loader data, before initializing comfy
export function loader({ params, context }: Route.LoaderArgs) {
  const { channel } = params;

  // Check instance access control
  const env = context.get(cloudflareEnvironmentContext);
  const allowedUsersRaw = env.ALLOWED_USERS ?? '';
  if (allowedUsersRaw.length > 0) {
    const allowedUsers = allowedUsersRaw
      .split(',')
      .map((u) => u.trim().toLowerCase());
    if (!allowedUsers.includes(channel.toLowerCase())) {
      return redirect('/private');
    }
  }

  return data({
    channel,
  });
}

/**
 * Primary Todo Sourc Component
 */
export default function TodoSource() {
  useNoTheme();
  const isDocumentVisible = useDocumentVisibilityState();
  const loaderData = useLoaderData<typeof loader>();
  const [rawParameters] = useSearchParams();
  const isDemo = rawParameters.get('demo')?.toLowerCase() === 'true';
  const comfy = useComfy(isDemo ? false : loaderData.channel);
  const [round, setRound] = useState<VoteRound>(EMPTY_ROUND);
  const { votes, startTime } = round;
  const [now, setNow] = useState(Date.now());
  const [overrides, setOverrides] = useState<
    Partial<z.infer<typeof parameterParser>>
  >({});
  const parameters = useMemo(() => {
    const fromURL = parameterParser.parse(
      Object.fromEntries(rawParameters.entries())
    );
    const result = { ...fromURL };

    // for each key in fromURL, if an override exists, use it instead
    for (const key of Object.keys(fromURL) as (keyof typeof fromURL)[]) {
      if (overrides[key] !== undefined) {
        // @ts-expect-error we know this is fine
        result[key] = overrides[key]!;
      }
    }

    if (isDemo) {
      result.duration = 10;
      result.cooldown = 5;
    }

    return result;
  }, [overrides, isDemo]);

  useIntervalWhen(
    () => {
      setNow(Date.now());
    },
    1000, // run callback every 1 second
    isDocumentVisible === 'visible'
  );

  const votingState = votingStateAt(startTime, now, parameters);

  const vote = useCallback(
    (name: string, option: string) => {
      const choice =
        parameters.choices.length > 0
          ? // if choices are defined, only allow those options, find the match ignoring case
            parameters.choices.find(
              (c) => c.toLocaleLowerCase() === option.toLocaleLowerCase()
            )
          : numericNormalizer(option);

      if (!choice) {
        return;
      }

      setRound((last) => applyVote(last, name, choice, Date.now(), parameters));
    },
    [parameters]
  );

  const voteWrapper = useEffectEvent(vote);

  const resetVotes = useCallback(() => {
    setRound(EMPTY_ROUND);
  }, []);

  // Standalone event emitter for demo mode (same event-driven path as comfy)
  const demoEvents = useRef(new EE<ComfyEvents>());
  const events = comfy?.events ?? demoEvents.current;

  const [demoRunning, setDemoRunning] = useState(false);
  const runDemo = useCallback(() => {
    if (demoRunning) return;
    setDemoRunning(true);
    resetVotes();

    const ee = demoEvents.current;
    const c = parameters.choices;
    const opt1 = c.length > 0 ? c[0] : '1';
    const opt2 = c.length > 1 ? c[1] : '2';
    const opt3 = c.length > 2 ? c[2] : '3';
    const opt4 = c.length > 3 ? c[3] : '4';

    const run = async () => {
      // Trickle in votes with lead changes so bars swap positions
      // opt2 takes early lead, opt4 enters
      ee.emit('chat', 'DemoUser1', opt2, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser2', opt2, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser3', opt4, nobody, false, fakeflags);
      await sleep(600);
      // opt1 catches up, opt3 enters
      ee.emit('chat', 'DemoUser4', opt1, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser5', opt3, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser6', opt4, nobody, false, fakeflags);
      await sleep(800);
      // opt1 takes the lead
      ee.emit('chat', 'DemoUser7', opt1, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser8', opt1, nobody, false, fakeflags);
      await sleep(600);
      // opt3 surges, opt2 gets another
      ee.emit('chat', 'DemoUser9', opt3, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser10', opt3, nobody, false, fakeflags);
      ee.emit('chat', 'DemoUser11', opt2, nobody, false, fakeflags);
      await sleep(700);
      // opt3 takes the lead at the end
      ee.emit('chat', 'DemoUser12', opt3, nobody, false, fakeflags);
    };

    run().catch(console.error);
  }, [demoRunning, resetVotes, parameters.choices]);

  // Clear the tallies once the cooldown ends so the next round starts fresh
  // (applyVote also starts a new round if this hasn't run yet).
  const roundOver = isRoundOver(round, now, parameters);
  useEffect(() => {
    if (!roundOver) return;
    resetVotes();
    setDemoRunning(false);
  }, [roundOver, resetVotes]);

  useEffect(() => {
    const onCommand: ComfyEvents['command'] = (
      _user,
      command,
      message,
      flags,
      _extra
    ) => {
      if (!flags.broadcaster && !flags.mod) {
        return;
      }

      const patch = commandOverrides(command, message);
      if (!patch) {
        console.error('Unknown command', {
          command,
          message,
        });
        return;
      }
      setOverrides((last) => ({ ...last, ...patch }));
      resetVotes();
    };

    const onChat: ComfyEvents['chat'] = (user, message, _flags, _extra) => {
      const firstWord = message.split(/ /)[0].trim().toLocaleLowerCase();
      voteWrapper(user, firstWord);
    };

    events.on('command', onCommand);
    events.on('chat', onChat);

    return () => {
      events.off('command', onCommand);
      events.off('chat', onChat);
    };
  }, [events, voteWrapper, resetVotes]);

  useEffect(() => {
    if (isDocumentVisible !== 'visible') {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis.window as unknown as { sendComfyEvent: any }).sendComfyEvent = (
      ...args: unknown[]
    ) => {
      if (args.length > 0) {
        // @ts-expect-error very intentional ignore. used to force tests
        events.emit(args[0] as string, ...args.slice(1));
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis.window as unknown as { simulate: any }).simulate = () => {
      // eslint-disable-next-line unicorn/consistent-function-scoping
      const simulate = async () => {
        events.emit('chat', 'SimulatedUser1', '1', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser2', '1', nobody, false, fakeflags);
        await sleep(1000);
        events.emit('chat', 'SimulatedUser3', '2', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser4', '69', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser5', '1', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser6', '1', nobody, false, fakeflags);
        await sleep(1500);
        events.emit('chat', 'SimulatedUser7', '2', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser8', '2', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser9', '3', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUser0', '1', nobody, false, fakeflags);
        await sleep(1000);
        events.emit('chat', 'SimulatedUsera', '4', nobody, false, fakeflags);
        events.emit('chat', 'SimulatedUserb', '1', nobody, false, fakeflags);
      };
      simulate().catch(console.error);
    };
  }, [isDocumentVisible, events]);

  const options = [...votes.entries()]
    // const options = [...fakedb.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([option, votes]) => ({ option, votes }));

  const totalVotes = options.reduce((total, { votes }) => total + votes, 0);

  return (
    <div
      className="w-screen h-screen overflow-hidden rounded-sm flex flex-col"
      style={{
        backgroundColor: parameters.bg,
        color: parameters.text,
      }}
    >
      <div
        className="p-2 flex flex-row items-center justify-start"
        style={{
          fontSize: 'clamp(14px, 7cqh, 48px)',
        }}
      >
        <div className="grow pt-2">
          {parameters.choices.length > 0 ? (
            <>
              {parameters.choices.map((choice, index) => (
                <span
                  key={choice}
                  className="px-2 py-1 mr-2 rounded-md bg-white/20"
                >
                  {choice}
                </span>
              ))}
            </>
          ) : undefined}
        </div>
        {votingState === 'ready' ? (
          <div className="flex flex-row items-center">
            <span className="opacity-0">00s</span>
            <div className="h-[1.8em] w-[1.8em]"></div>
          </div>
        ) : votingState === 'locked' ? (
          <div className="flex flex-row items-center">
            <span className="opacity-0">00s</span>
            <Lock className="inline-block h-[1.8em] w-[1.8em]" />
          </div>
        ) : (
          <div className="flex flex-row items-center">
            <span>
              {`${Math.max(
                0,
                Math.ceil((startTime + parameters.duration * 1000 - now) / 1000)
              )}s`}
            </span>
            <Timer className="inline-block ml-1 h-[1.8em] w-[1.8em]" />
          </div>
        )}
      </div>
      <div className="relative w-full h-full flex-1">
        {options.map(({ option, votes }, index) => {
          const offset = index * 100;
          return (
            <div
              key={option}
              className="absolute left-0 top-0 h-[25%] px-2 flex flex-col items-center w-full [container-type:size] transition-all ease-in-out duration-300"
              style={{
                transform: `translateY(${offset}%)`,
                opacity: votingState === 'locked' && index > 0 ? 0.5 : 1,
              }}
            >
              <div
                className="w-full font-bold px-2 pb-1"
                style={{
                  fontSize: 'clamp(20px, 7cqh, 40px)',
                  letterSpacing: '2px',
                }}
              >
                <span>{option}</span>
                <span className="pl-1 opacity-80 font-normal text-[80%]">
                  ({votes})
                </span>
              </div>
              <div className="flex flex-row items-center w-full">
                <div
                  className="border-1 border-[#111111] transition-all ease-in-out rounded-md duration-300"
                  style={{
                    backgroundColor: parameters.bar,
                    width: `${(votes / totalVotes) * 100}%`,
                    // height is min 4px otherwise 10% of parent
                    height: 'max(20%, 10px)',
                  }}
                ></div>
                <div className="flex-grow transition-all ease-in-out duration-300">
                  {/* pads out remainder of bar */}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {isDemo && !demoRunning && (
        <button
          type="button"
          onClick={runDemo}
          className="absolute bottom-3 right-3 rounded-full bg-white/20 hover:bg-white/40 p-2 transition-colors"
        >
          <Play className="h-5 w-5" style={{ color: parameters.text }} />
        </button>
      )}
    </div>
  );
}
