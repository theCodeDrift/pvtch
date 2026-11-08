import { describe, expect, it } from 'vitest';
import {
  applyVote,
  commandOverrides,
  type CommandOverrides,
  EMPTY_ROUND,
  isRoundOver,
  votingStateAt,
} from '../../app/lib/one-second-vote';

const timing = { duration: 10, cooldown: 5, repeat: false };
const start = 1_000_000;

describe('votingStateAt', () => {
  it('walks ready -> voting -> locked -> ready', () => {
    expect(votingStateAt(0, start, timing)).toBe('ready');
    expect(votingStateAt(start, start + 1000, timing)).toBe('voting');
    expect(votingStateAt(start, start + 11_000, timing)).toBe('locked');
    expect(votingStateAt(start, start + 16_000, timing)).toBe('ready');
  });
});

describe('applyVote', () => {
  it('starts a round on the first vote', () => {
    const round = applyVote(EMPTY_ROUND, 'Alice', '1', start, timing);
    expect(round.startTime).toBe(start);
    expect(round.votes).toEqual(new Map([['1', 1]]));
    expect(round.voters).toEqual(new Map([['alice', '1']]));
  });

  it('refuses a second vote from the same viewer unless repeat is on', () => {
    const first = applyVote(EMPTY_ROUND, 'Alice', '1', start, timing);
    expect(applyVote(first, 'ALICE', '2', start + 1000, timing)).toBe(first);

    const repeated = applyVote(first, 'alice', '2', start + 1000, {
      ...timing,
      repeat: true,
    });
    expect(repeated.votes).toEqual(
      new Map([
        ['1', 1],
        ['2', 1],
      ])
    );
  });

  it('refuses votes while locked', () => {
    const first = applyVote(EMPTY_ROUND, 'Alice', '1', start, timing);
    expect(applyVote(first, 'Bob', '1', start + 12_000, timing)).toBe(first);
  });

  it('starts a fresh round once the cooldown has ended', () => {
    let round = applyVote(EMPTY_ROUND, 'Alice', '1', start, timing);
    round = applyVote(round, 'Bob', '2', start + 2000, timing);
    expect(isRoundOver(round, start + 16_000, timing)).toBe(true);

    const later = start + 20_000;
    const next = applyVote(round, 'Alice', '3', later, timing);
    expect(next.startTime).toBe(later);
    expect(next.votes).toEqual(new Map([['3', 1]]));
    expect(next.voters).toEqual(new Map([['alice', '3']]));
    expect(votingStateAt(next.startTime, later + 1000, timing)).toBe('voting');
  });

  it('does not treat a round as over before its cooldown ends', () => {
    const round = applyVote(EMPTY_ROUND, 'Alice', '1', start, timing);
    expect(isRoundOver(round, start, timing)).toBe(false);
    expect(isRoundOver(round, start + 15_000, timing)).toBe(false);
    expect(isRoundOver(EMPTY_ROUND, start + 99_000, timing)).toBe(false);
  });
});

function runCommands(...commands: [string, string][]): CommandOverrides {
  let overrides: CommandOverrides = {};
  for (const [command, message] of commands) {
    overrides = { ...overrides, ...commandOverrides(command, message) };
  }
  return overrides;
}

describe('commandOverrides', () => {
  it('keeps list choices when the timer changes, and vice versa', () => {
    expect(
      runCommands(
        ['1s', 'list a, b, c'],
        ['1s', 'timer 20/5'],
        ['1s', 'vote many']
      )
    ).toEqual({
      choices: ['a', 'b', 'c'],
      duration: 20,
      cooldown: 5,
      repeat: true,
    });
  });

  it('clears only its own keys when given no arguments', () => {
    expect(
      runCommands(['1s', 'list a, b'], ['1s', 'timer 20/5'], ['1s', 'timer'])
    ).toEqual({
      choices: ['a', 'b'],
      duration: undefined,
      cooldown: undefined,
    });
  });

  it('returns {} for reset and undefined for unknown commands', () => {
    expect(commandOverrides('1s', 'reset')).toEqual({});
    expect(commandOverrides('1s', 'nope')).toBeUndefined();
  });
});
