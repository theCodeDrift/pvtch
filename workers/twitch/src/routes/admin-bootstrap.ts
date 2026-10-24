import { getSessionUser, isAdmin } from '../session';
import { bootstrapRevokeSubscription } from '../twitch/subscriptions';

/**
 * /admin/bootstrap: GET shows a button, POST creates the app-wide
 * `user.authorization.revoke` subscription (idempotent). The session cookie
 * is SameSite=Lax, so a cross-site form can't POST here as an admin.
 */
export async function adminBootstrap(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAdmin(env, await getSessionUser(request, env))) {
    return new Response(undefined, { status: 403 });
  }

  if (request.method === 'GET') {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Bootstrap</title>
<form method="post"><button>Create user.authorization.revoke subscription</button></form>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const result = await bootstrapRevokeSubscription(env);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
