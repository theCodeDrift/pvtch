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
  isPrivate = false,
  isAllowed = true,
}: {
  isPrivate?: boolean;
  isAllowed?: boolean;
}) => {
  // pvtch_token is HttpOnly; pvtch_name is set and cleared alongside it.
  const [userName] = useCookie('pvtch_name');
  const loginUrl = useLoginUrl();
  const isLoggedIn = !!userName;

  const displayName = userName ? decodeURIComponent(userName) : undefined;

  const handleLogout = useCallback(() => {
    void signOut();
  }, []);

  if (isLoggedIn && isPrivate && !isAllowed) {
    return (
      <Button variant="ghost" className="h-9 gap-1.5 px-3 text-sm" asChild>
        <a href="/private">
          <X size={16} />
          {displayName ?? 'Logged in'}
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
            {displayName ?? 'Logged in'}
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
