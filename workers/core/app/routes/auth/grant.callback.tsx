import type { Route } from './+types/grant.callback';
import { cloudflareEnvironmentContext } from '@/context';
import { completeGrant } from '@/lib/scope-grant';

export function loader({ request, context }: Route.LoaderArgs) {
  return completeGrant(request, context.get(cloudflareEnvironmentContext));
}
