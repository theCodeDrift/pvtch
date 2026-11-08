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
