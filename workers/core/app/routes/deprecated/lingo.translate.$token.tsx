import type { Route } from './+types/lingo.translate.$token';
import { cloudflareEnvironmentContext } from '@/context';
import { handleDeprecatedRoute } from '@/lib/deprecated-route';

// Retired with Workers AI's Qwen model; Lingual replaces it.
export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  return handleDeprecatedRoute(params.token, env);
}

export async function action({ params, context }: Route.ActionArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  return handleDeprecatedRoute(params.token, env);
}
