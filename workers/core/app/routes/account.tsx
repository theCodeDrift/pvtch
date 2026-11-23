import { Link, data, redirect, useLoaderData } from 'react-router';
import { LogOut, Trash2 } from 'lucide-react';
import type { Route } from './+types/account';
import { userContext } from '@/context';
import { RotateOverlayKey } from '@/components/rotate-overlay-key';
import { SignOutEverywhere } from '@/components/sign-out-everywhere';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { signOut } from '@/lib/sign-out';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Account - PVTCH' }];
}

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  if (!user) return redirect('/auth/start');
  return data({ displayName: user.displayName, login: user.login });
}

export default function Account() {
  const { displayName, login } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Account
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Signed in as {displayName} (@{login}).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            Sign out here, or sign out every other browser and device. Your
            overlays keep working either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
          <SignOutEverywhere />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Overlay key</CardTitle>
          <CardDescription>
            Your overlay and API URLs share one secret key. If one of them
            leaked, rotate the key to replace it everywhere. Rotating also signs
            you out on your other browsers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RotateOverlayKey />
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently delete your PVTCH account and everything stored for it.
            This can&apos;t be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" asChild>
            <Link to="/account/delete">
              <Trash2 className="h-4 w-4" />
              Delete account
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
