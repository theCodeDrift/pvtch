import { useCallback, useState } from 'react';
import Cookies from 'js-cookie';

/**
 * Login sets pvtch cookies on the parent domain (`Domain=pvtch.com`) so
 * twitch.pvtch.com can read them. A plain remove only clears a host-only
 * cookie, so also remove the parent-domain copy. Returns undefined for
 * localhost and IP addresses, where cookies are host-only.
 */
function parentDomain(hostname: string): string | undefined {
  const labels = hostname.split('.');
  if (labels.length < 2 || /^[\d.]+$/.test(hostname)) return undefined;
  return labels.slice(-2).join('.');
}

type CookiesReturn = [
  string | undefined,
  (newValue: string, options?: Cookies.CookieAttributes) => void,
  () => void,
];

/**
 * A hook that allows to manage cookies.
 * @param {string} cookieName - The name of the cookie.
 * @requires js-cookie
 * @returns {CookiesReturn} An array of three elements:
 * 1. The current value of the cookie.
 * 2. A function to update the cookie value.
 * 3. A function to delete the cookie.
 */
export default function useCookie(cookieName: string): CookiesReturn {
  const [value, setValue] = useState<string | undefined>(() =>
    Cookies.get(cookieName)
  );

  const updateCookie = useCallback(
    (newValue: string, options?: Cookies.CookieAttributes) => {
      Cookies.set(cookieName, newValue, options);
      setValue(newValue);
    },
    [cookieName]
  );

  const deleteCookie = useCallback(() => {
    Cookies.remove(cookieName);
    const domain =
      globalThis.window === undefined
        ? undefined
        : parentDomain(globalThis.window.location.hostname);
    if (domain) Cookies.remove(cookieName, { domain });
    setValue(undefined);
  }, [cookieName]);

  return [value, updateCookie, deleteCookie];
}
