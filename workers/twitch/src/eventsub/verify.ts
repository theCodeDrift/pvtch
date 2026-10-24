/** Twitch rejects (and so do we) notifications older than this. */
export const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Compare without exiting early, so timing doesn't reveal the match length. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (const [index, byte] of left.entries()) {
    difference |= byte ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Verify an EventSub webhook signature: HMAC-SHA256 with the subscription
 * secret over `message id + timestamp + raw body`, sent as `sha256=<hex>`.
 * `body` must be the request text exactly as received; parsing and
 * re-serializing changes the bytes and breaks the signature.
 */
export async function verifySignature(
  secret: string,
  messageId: string,
  timestamp: string,
  body: string,
  signatureHeader: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(messageId + timestamp + body)
  );
  return constantTimeEqual(`sha256=${toHex(mac)}`, signatureHeader);
}

/** True when the EventSub timestamp is within the replay window. */
export function isFresh(timestamp: string, now = Date.now()): boolean {
  const sentAt = Date.parse(timestamp);
  return !Number.isNaN(sentAt) && now - sentAt <= MAX_MESSAGE_AGE_MS;
}
