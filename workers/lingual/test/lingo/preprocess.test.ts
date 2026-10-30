import { describe, it, expect } from 'vitest';
import { preprocess, graphemeLength } from '../../src/lingo/preprocess';

describe('preprocess', () => {
  it('strips http and https URLs', () => {
    expect(preprocess('check http://x.com/path?q=1 and https://y.com')).toBe(
      'check and'
    );
  });

  it('strips @mentions but keeps surrounding words', () => {
    expect(preprocess('hello @bob how are you')).toBe('hello how are you');
  });

  it('strips Twitch-style emote tokens with internal capitals', () => {
    expect(preprocess('PogChamp the win monkaW peepoSad nice')).toBe(
      'the win nice'
    );
  });

  it('strips all-caps emote tokens of 3+ chars', () => {
    expect(preprocess('LULW that was funny KEKW')).toBe('that was funny');
  });

  it('keeps sentence-initial capitalized words', () => {
    // "Hello" / "World" are not emote-shaped (single leading capital)
    expect(preprocess('Hello there my friend World')).toBe(
      'Hello there my friend World'
    );
  });

  it('collapses repeated whitespace from stripping', () => {
    expect(preprocess('a   b   c')).toBe('a b c');
  });

  it('returns empty string when everything strips', () => {
    expect(preprocess('@a @b PogChamp LULW https://x')).toBe('');
  });

  it('collapses 3+ identical char runs to 2 chars', () => {
    expect(preprocess('atissssssssssaaaaa')).toBe('atissaa');
    expect(preprocess('haiiiiiiiiiii chelle!')).toBe('haii chelle!');
    expect(preprocess('yeeessss')).toBe('yeess');
  });

  it('preserves legitimate doubled letters', () => {
    expect(preprocess('bookkeeper has Hawaii Mississippi')).toBe(
      'bookkeeper has Hawaii Mississippi'
    );
  });

  it('collapses repeats across the whole sentence', () => {
    // verify the collapse runs after rejoining tokens, not only within tokens
    expect(preprocess('hellooooooo there')).toBe('helloo there');
  });
});

describe('graphemeLength', () => {
  it('counts ASCII characters', () => {
    expect(graphemeLength('hello')).toBe(5);
  });

  it('counts multi-codepoint emoji as one grapheme', () => {
    // Family emoji is a ZWJ sequence
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
  });

  it('counts CJK characters individually', () => {
    expect(graphemeLength('안녕하세요')).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(graphemeLength('')).toBe(0);
  });
});
