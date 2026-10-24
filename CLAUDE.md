## Code Standards

When creating or modifying files, you **MUST** follow these conventions:

- Code Style Guide @.conventions/STYLEGUIDE-CODE.md
- UI Conventions @.conventions/STYLEGUIDE-UI.md
- When a user asks about what you can do, you _should_ suggest actions from this CLAUDE.md file.
- **NEVER** read a `.dev.vars` or `.env` or `.secrets` file

## Code Quality Checks

**IMPORTANT** After making code changes, you **MUST** run the checks specified in @.conventions/STYLEGUIDE-CODE.md

## Git Commits

When creating commit messages:

- **BE AWARE** `git commit` **MUST** run with the `-S` flag. When in some environments, this will fail. You should offer a commit message in that scenario.
- **GPG Signing Workaround:** If signing fails due to no TTY available, prompt the user to run `echo "test" | gpg --sign > /dev/null` to load the GPG signing key, then retry the commit.
- **NEVER** add "Generated with Claude Code" or similar attribution lines
- **NEVER** add `Co-Authored-By: Claude` or any AI co-author attribution
- Developers are 100% accountable for all code they commit, regardless of how it was created

## Worktrees

When working in a git worktree:

1. Worktrees live under `worktrees/` in the main checkout (never nested inside another worktree). `worktrees/` is git-ignored.
2. A new worktree starts from the latest `main` unless told otherwise: `git fetch`, then rebase onto whichever of local `main` and `origin/main` is ahead.
3. Run `pnpm install` in the worktree before running any of its scripts; dependencies installed in the main checkout may not resolve from a worktree.
   - Write `workers/core/.dev.vars` in the worktree defining `DEVELOPMENT`, `DISABLE_CACHE`, `TWITCH_CLIENT_ID`, `PVTCH_APP_URL` and `TWITCH_REDIRECT_URI` (`TWITCH_SECRET` is a Secrets Store binding, not a dev var) (local values; never read or copy another checkout's `.dev.vars`). Without it, `wrangler types` regenerates `worker-configuration.d.ts` with different vars and the committed file drifts.
4. Do all work in the worktree, never in the main checkout.
