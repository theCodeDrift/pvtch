import { useCallback, useEffect, useState } from 'react';
import { LogOut, X } from 'lucide-react';
import { TwitchIcon } from '@/components/ui/icons/twitch';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useCookie from '@/hooks/use-cookie';
import { signOut } from '@/lib/sign-out';

export function useLoginUrl() {
  const [loginUrl, setLoginUrl] = useState<string>('#');

  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }

    const url = new URL('/auth/start', globalThis.window.location.origin);
    setLoginUrl(url.toString());
  }, []);

  return loginUrl;
}

export const TwitchLogin = ({
  displayName,
  isPrivate = false,
  isAllowed = true,
}: {
  /** From the layout loader: the signed-in user, or null with no session. */
  displayName: string | null;
  isPrivate?: boolean;
  isAllowed?: boolean;
}) => {
  const [userName, , removeUserName] = useCookie('pvtch_name');
  const loginUrl = useLoginUrl();
  const isLoggedIn = displayName !== null;

  // A name cookie with no session (expired, or from before sessions) is stale.
  useEffect(() => {
    if (!isLoggedIn && userName !== undefined) removeUserName();
  }, [isLoggedIn, userName, removeUserName]);

  const handleLogout = useCallback(() => {
    void signOut();
  }, []);

  if (isLoggedIn && isPrivate && !isAllowed) {
    return (
      <Button variant="ghost" className="h-9 gap-1.5 px-3 text-sm" asChild>
        <a href="/private">
          <X size={16} />
          {displayName}
        </a>
      </Button>
    );
  }

  if (isLoggedIn) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-1.5 px-3 text-sm">
            <TwitchIcon size={16} />
            {displayName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button variant="ghost" size="icon" className="size-9" asChild>
      <a href={loginUrl}>
        <TwitchIcon size={16} />
        <span className="sr-only">Sign in with Twitch</span>
      </a>
    </Button>
  );
};
