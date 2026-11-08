import { normalizeKey } from '@/lib/normalize-key';
import type { LingoPluginConfig } from '../../do/plugins/lingo';

/**
 * Temporary migration: Lingo config used to live in a `PvtchBackend` DO
 * keyed by the user's overlay token. Copy it into the user's `User` DO if
 * that has no config yet, and return the config the user now has.
 *
 * Throws if either DO call fails, so a caller that is about to give up the
 * token (rotation) can stop before the old config becomes unreachable. A
 * malformed old value counts as nothing to migrate.
 */
export async function importLegacyLingoConfig(
  env: Env,
  userId: string,
  token: string
): Promise<LingoPluginConfig | undefined> {
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${userId}`)
  );
  using lingoPlugin = await stub.lingo();
  const existing = await lingoPlugin.getConfig();
  if (existing) return existing;

  const oldStub = env.PVTCH_BACKEND.get(
    env.PVTCH_BACKEND.idFromName(normalizeKey(token, 'lingo-config'))
  );
  const migrated = parseLegacy(await oldStub.get());
  if (!migrated) return undefined;
  return lingoPlugin.import(migrated);
}

function parseLegacy(raw: string): LingoPluginConfig | undefined {
  if (!raw) return undefined;
  let parsed: { bots?: string[] | string; language?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return undefined;
  }
  return {
    bots: [parsed.bots ?? []].flat().filter((v) => v !== undefined),
    language: parsed.language || 'english',
  };
}
