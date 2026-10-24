import type { LingoPluginConfig } from '../../core/do/plugins/lingo';
import type { User } from '../../core/do/user';

/**
 * Core's User DO, bound read-only from pvtch-api (`script_name`). Wrangler
 * would type this binding through core's worker entry, which imports the
 * whole React Router app, so the binding is typed against the User class
 * directly instead. Only `lingo().getConfig()` is used.
 */
function userStub(env: Env, broadcasterId: string): DurableObjectStub<User> {
  return env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${broadcasterId}`)
  ) as DurableObjectStub<User>;
}

/** The broadcaster's Lingo settings (target language, ignored users). */
export async function getLingoConfig(
  env: Env,
  broadcasterId: string
): Promise<LingoPluginConfig | undefined> {
  using lingo = await userStub(env, broadcasterId).lingo();
  return lingo.getConfig();
}
