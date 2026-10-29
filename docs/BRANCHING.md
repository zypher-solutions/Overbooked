# Branches and releases

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | what the shops use | production |
| `development` | integration, tested together | staging |
| `feature/*`, `fix/*` | one piece of work, branched from `development` | nothing (CI only) |
| `hotfix/*` | an urgent production fix, branched from `main`, merged back into `main` and `development` | production |

Flow: branch, local tests, pull request into `development` (CI must pass), test on staging, Mohammed approves,
pull request `development` into `main`, tag `vX.Y.Z`, production deploy. Only Mohammed merges into `main`.

Protect `main` and `development` on GitHub (Settings > Branches): require a pull request, require the `ci` checks
(`app`, `database`, `browser`), require review from Code Owners, block force pushes and deletion.
Replace the placeholder user in `.github/CODEOWNERS` with the real GitHub name first.

Until the hosted projects exist, "staging" and "production" are two local Docker databases: a second local stack for
staging can run with `npx supabase start --workdir <copy>` on other ports; nothing real is stored in either.
Commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`), ending with the co-author line the tooling adds.
Tags: `vMAJOR.MINOR.PATCH`; each tag has a CHANGELOG entry and the list of migrations it needs.
