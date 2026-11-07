import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MESSAGE_CACHE_MAX_KEYS,
  MESSAGE_CACHE_TTL_MS,
  MessageCache,
} from '../src/durable-objects/twitch-channel/plugins/message-cache';

describe('MessageCache', () => {
  let cache: MessageCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MessageCache();
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

    vi.advanceTimersByTime(MESSAGE_CACHE_TTL_MS);

    expect(cache.firstSeen('a')).toBe(true);
  });

  it('does not extend the window on a repeat', () => {
    cache.firstSeen('a');

    vi.advanceTimersByTime(MESSAGE_CACHE_TTL_MS - 1);
    expect(cache.firstSeen('a')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(cache.firstSeen('a')).toBe(true);
  });

  it('drops the oldest key past the size limit', () => {
    for (let index = 0; index < MESSAGE_CACHE_MAX_KEYS; index++) {
      cache.firstSeen(`key-${index}`);
    }
    expect(cache.firstSeen('key-1')).toBe(false);

    expect(cache.firstSeen('one-more')).toBe(true);

    expect(cache.firstSeen('key-0')).toBe(true);
  });
});
