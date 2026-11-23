import { CheckCircle } from 'lucide-react';
import type { Route } from './+types/account.deleted';
import { TwitchNextSteps } from '@/components/twitch-next-steps';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Account deleted - PVTCH' }];
}

/** Where account deletion lands. Static: the user has no session anymore. */
export default function AccountDeleted() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          <CheckCircle className="h-7 w-7" />
          Your account was deleted
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          All of your PVTCH data is deleted: your overlays, progress bars,
          boards, Lingo and Lingual settings, and the account itself. If you
          sign in again later, you start fresh.
        </p>
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Finish up on Twitch
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          PVTCH can&apos;t do these for you:
        </p>
        <TwitchNextSteps />
      </div>
    </div>
  );
}
