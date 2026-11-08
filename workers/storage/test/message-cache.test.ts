import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MESSAGE_CACHE_TTL_MS,
  MESSAGE_CACHE_MAX_KEYS,
  MessageCache,
} from '../src/durable-objects/twitch-channel/plugins/message-cache';

const TTL_MS = 60_000;

describe('MessageCache', () => {
  let cache: MessageCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MessageCache(String(TTL_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a key once within the window', () => {
    expect(cache.firstSeen('a')).toBe(true);
    expect(cache.firstSeen('a')).toBe(false);
    expect(cache.firstSeen('b')).toBe(true);
  });

  it('forgets a key once the window ends', () => {
    cache.firstSeen('a');

    vi.advanceTimersByTime(TTL_MS);

    expect(cache.firstSeen('a')).toBe(true);
  });

  it('does not extend the window on a repeat', () => {
    cache.firstSeen('a');

    vi.advanceTimersByTime(TTL_MS - 1);
    expect(cache.firstSeen('a')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(cache.firstSeen('a')).toBe(true);
  });

  it('lets the owner release a mark early', () => {
    cache.firstSeen('a', 'q-1');

    expect(cache.release('a', 'q-1')).toBe(true);

    expect(cache.firstSeen('a', 'q-2')).toBe(true);
  });

  it('keeps a mark another owner set', () => {
    cache.firstSeen('a', 'q-1');

    expect(cache.release('a', 'q-other')).toBe(false);

    expect(cache.firstSeen('a')).toBe(false);
  });

  it('keeps a newer mark from a late release', () => {
    cache.firstSeen('a', 'q-1');
    vi.advanceTimersByTime(TTL_MS);
    expect(cache.firstSeen('a', 'q-2')).toBe(true);

    expect(cache.release('a', 'q-1')).toBe(false);

    expect(cache.firstSeen('a')).toBe(false);
  });

  it('keeps a mark set without an owner', () => {
    cache.firstSeen('a');

    expect(cache.release('a', 'q-1')).toBe(false);

    expect(cache.firstSeen('a')).toBe(false);
  });

  it('releases nothing for an unknown key', () => {
    expect(cache.release('a', 'q-1')).toBe(false);
  });

  it.each(['', 'soon', '0', '-1'])(
    'falls back on a bad lifetime: %j',
    (ttl) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fallback = new MessageCache(ttl);
      fallback.firstSeen('a');

      vi.advanceTimersByTime(DEFAULT_MESSAGE_CACHE_TTL_MS - 1);
      expect(fallback.firstSeen('a')).toBe(false);

      vi.advanceTimersByTime(1);
      expect(fallback.firstSeen('a')).toBe(true);
      expect(error).toHaveBeenCalledOnce();
      error.mockRestore();
    }
  );

  it('drops the oldest key past the size limit', () => {
    for (let index = 0; index < MESSAGE_CACHE_MAX_KEYS; index++) {
      cache.firstSeen(`key-${index}`);
    }
    expect(cache.firstSeen('key-1')).toBe(false);

    expect(cache.firstSeen('one-more')).toBe(true);

    expect(cache.firstSeen('key-0')).toBe(true);
  });
});
