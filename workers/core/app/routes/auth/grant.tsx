import type { Route } from './+types/grant';
import { cloudflareEnvironmentContext } from '@/context';
import { startGrant } from '@/lib/scope-grant';

export function loader({ request, context }: Route.LoaderArgs) {
  return startGrant(request, context.get(cloudflareEnvironmentContext));
}
