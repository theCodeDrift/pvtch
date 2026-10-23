/**
 * pvtch Storage Worker
 *
 * Hosts Durable Objects for cross-worker access. Other workers bind to these
 * DOs via `script_name: "pvtch-storage"`. Serves no public routes.
 */
import type { Expect, AssertRPCSerializable } from './rpc-type-checks';
import type { TwitchChannel } from './durable-objects/twitch-channel';

export { TwitchChannel } from './durable-objects/twitch-channel';

// Compile-time: assert all DO RPC methods return serializable types.
// When adding a new DO, add an assertion here.
type _AssertTwitchChannel = Expect<AssertRPCSerializable<TwitchChannel>>;

export default {
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
