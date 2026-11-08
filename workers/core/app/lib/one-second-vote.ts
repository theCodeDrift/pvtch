/**
 * Round logic for the 1s voting widget (`routes/sources/1s.$channel.tsx`).
 * A round starts with its first vote, accepts votes for `duration` seconds,
 * stays locked for `cooldown` seconds, then ends. The next vote after that
 * starts a fresh round.
 */

export type VotingState = 'ready' | 'voting' | 'locked';

export interface VoteRound {
  /** When the round's first vote arrived, or 0 if no round is running. */
  startTime: number;
  /** option -> vote count */
  votes: Map<string, number>;
  /** lowercased username -> option */
  voters: Map<string, string>;
}

export interface RoundTiming {
  /** Seconds the round accepts votes. */
  duration: number;
  /** Seconds the results stay locked after voting closes. */
  cooldown: number;
}

export const EMPTY_ROUND: VoteRound = {
  startTime: 0,
  votes: new Map(),
  voters: new Map(),
};

export function votingStateAt(
  startTime: number,
  now: number,
  { duration, cooldown }: RoundTiming
): VotingState {
  if (startTime === 0 || now <= startTime) return 'ready';
  if (now > startTime + (duration + cooldown) * 1000) return 'ready';
  if (now > startTime + duration * 1000) return 'locked';
  return 'voting';
}

/** Whether a round ran and its cooldown has ended. */
export function isRoundOver(
  round: VoteRound,
  now: number,
  { duration, cooldown }: RoundTiming
): boolean {
  return (
    round.startTime !== 0 &&
    now > round.startTime + (duration + cooldown) * 1000
  );
}

/**
 * The round after `name` votes for `choice` at `now`, or `round` unchanged
 * if the vote isn't accepted. A vote after the previous round ended starts
 * a new round, so stale tallies and voters never carry over.
 */
export function applyVote(
  round: VoteRound,
  name: string,
  choice: string,
  now: number,
  timing: RoundTiming & { repeat: boolean }
): VoteRound {
  const current = isRoundOver(round, now, timing) ? EMPTY_ROUND : round;
  const state = votingStateAt(current.startTime, now, timing);
  if (state === 'locked') return round;

  const voter = name.toLowerCase();
  if (!timing.repeat && current.voters.has(voter)) return round;

  const votes = new Map(current.votes);
  votes.set(choice, (votes.get(choice) ?? 0) + 1);
  const voters = new Map(current.voters);
  voters.set(voter, choice);
  return {
    startTime: current.startTime === 0 ? now : current.startTime,
    votes,
    voters,
  };
}

/** Settings the `!1s` mod commands can override. */
export interface CommandOverrides {
  duration?: number;
  cooldown?: number;
  repeat?: boolean;
  choices?: string[];
}

/**
 * The overrides a broadcaster/mod `!1s` command sets: `{}` for `!1s reset`,
 * undefined for an unknown command. A key set to undefined falls back to the
 * URL parameter. Merge the result into the current overrides with
 * `{ ...last, ...patch }` so one command never wipes another's settings.
 */
export function commandOverrides(
  command: string,
  message: string
): CommandOverrides | undefined {
  const args = message
    .split(/ /g)
    .map((s) => s.trim().toLocaleLowerCase())
    .filter((v) => v && v.length > 0);
  switch (`${command.toLocaleLowerCase()} ${args[0]}`) {
    case '1s timer': {
      const [duration, cooldown] = (args[1]?.split('/') ?? [])
        .map((v) => Number.parseInt(v, 10))
        .filter((v) => !Number.isNaN(v));
      return {
        duration: duration && duration > 0 ? duration : undefined,
        cooldown: cooldown && cooldown > 0 ? cooldown : undefined,
      };
    }
    case '1s vote': {
      const mode = args[1];
      return {
        repeat: mode === 'many' ? true : mode === 'one' ? false : undefined,
      };
    }
    case '1s list': {
      const list = message
        .split(/ /g)
        .map((s) => s.trim())
        .filter((v, index) => index !== 0 && v && v.length > 0)
        .join(' ')
        .split(',')
        .map((s) => s.trim())
        .filter((v) => v && v.length > 0);
      return { choices: list.length > 0 ? list : undefined };
    }
    case '1s reset': {
      return {};
    }
    default: {
      return undefined;
    }
  }
}
