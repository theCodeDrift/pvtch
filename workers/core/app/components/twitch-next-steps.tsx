/**
 * What's left for a user to do on Twitch after deleting their PVTCH
 * account. PVTCH can't do these: it keeps no Twitch token for the user, and
 * only the streamer can unmod the bot.
 */
export function TwitchNextSteps() {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
      <li>
        Disconnect PVTCH from your Twitch account under{' '}
        <a
          href="https://www.twitch.tv/settings/connections"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          Twitch → Settings → Connections
        </a>
        . This removes the permissions you granted.
      </li>
      <li>
        If you made pvtchbot a moderator for Lingual, unmod it by typing{' '}
        <code className="rounded bg-muted px-1">/unmod pvtchbot</code> in your
        chat.
      </li>
      <li>
        Remove PVTCH browser sources from OBS and any chat-bot commands that
        call PVTCH URLs. They no longer work.
      </li>
    </ol>
  );
}
