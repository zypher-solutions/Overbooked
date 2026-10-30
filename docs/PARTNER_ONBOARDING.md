# Welcome: working on Overbooked

For a new partner or developer joining the project. Written 30 October 2026.

> **What this means for you:** read the report first, set up the project on your own computer, and work on your own branch. You never need any key or password of the live system, and you never touch TRENDZ.

# 1. What this project is
Overbooked is rental shop software, sold by Zypher. The first target is bridal and groom rental shops. It is a Next.js web app with a Supabase (Postgres) database. The business rules live in the database, so the screens only show them. Everything runs on your own computer for now. Nothing is online yet.

# 2. What the owner gives you

## 2.1 Read, in this order
1. **`docs/PROJECT_REPORT.docx`** (or `.md`). The complete picture: what exists, every screen and button, every fault, the business plan, what is left. Start here.
2. **`docs/HANDOVER.md`**. The latest state, open questions and the rules.
3. **`CLAUDE.md`**. The project rules. If you use Claude Code, it reads this file by itself.
4. **`docs/SETUP.md`**. How to run it on your computer.
5. **`docs/ARCHITECTURE.md`** and **`docs/DATABASE.md`**. How it is built and what the database does.
6. **`docs/BRANCHING.md`** and **`docs/RUNBOOKS.md`**. How we use GitHub, and the steps for backups, support access and problems.
7. **`docs/APP_CONTRACT.md`**, only if you work on the mobile app. It is out of date (see the report, item H1).

## 2.2 Access to give

| What | Give | Do not give |
|---|---|---|
| GitHub repository | A collaborator with **Write** access. `main` and `development` are protected, so he cannot push to them directly | Admin or Owner access |
| Supabase and Vercel (later) | A **developer** seat on the **test** project only | The live project, the organisation owner login, or billing |
| Secret keys | Nothing. He makes his own local keys with `npx supabase start` | The live service key, any key in chat, email or screenshots |
| TRENDZ | **Nothing at all.** Not the repository, not the databases, not the keys | |
| Money accounts | Nothing (bank, Razorpay, GST login) | |

## 2.3 In writing, before he gets the code
- **The code belongs to Zypher.** Say it in a short signed agreement.
- Confidentiality: the customer details, the prices and the plans.
- What he does and how he is paid (salary, share or commission). Decide this between partners and write it down.
- A lawyer or accountant should look at it.

# 3. Setting up on his computer (first day)

Needs: Node.js 22 or newer, Docker Desktop (running), Git.

```
git clone <the GitHub address of the repository>
cd overbooked
npm install
npx supabase start
```

- `npx supabase start` builds a **local** database from the migration files and loads demo data. It prints a local address and a local key.
- Copy `.env.example` to `.env.local`. Paste the local address and key from the screen into it (the names are in the file). **These local keys only work on his own computer.** He never shares them and never commits `.env.local`.
- Run the app and open it:

```
npm run dev
```

Open `http://localhost:3000`. The demo logins are listed at the top of `supabase/seed.sql`. The demo password is in the test files. These are for the local database only and must never exist online.

**Check that everything works** (reset the local database before each test run):

```
npx supabase db reset
npx supabase test db
npx tsc --noEmit
npm run lint
npx playwright test
```

All of these pass today: 358 database checks and 25 browser tests.

# 4. The rules (short)
- **Never touch TRENDZ.** No code, no databases, no keys.
- **Never read, print or commit `.env` files or keys.**
- **Plan first.** For anything bigger than a small fix, write down the plan and agree it with the owner before changing code.
- **No new packages without asking.**
- **A business rule that is unclear:** write down your assumption and ask.
- **Commit and push only on your own branch.** Do not merge into `main`. The owner does that.
- **Where Overbooked differs from TRENDZ, say so and ask.** Do not quietly keep one way.
- **A passing test is not proof that it looks right.** Open the page in the browser.
- **Check the database as well as the menu** when a role loses access.

# 5. How the two of you work together

## 5.1 Branches and changes
- Start from `development`. Name your branch `feature/short-name` or `fix/short-name`.
- Open a **pull request into `development`**. The automatic checks must pass. Then the owner approves.
- `main` is the live line. It changes only from `development`, with a version tag, by the owner.
- Commit messages start with `feat:`, `fix:`, `docs:` or `chore:`. Keep each commit to one thing.

## 5.2 Database changes: one important catch
- Every database change is a new file in `supabase/migrations/`, applied in file-name order. Never edit an old file once it has been used online.
- **Until 1 November 2026, do not use `npx supabase migration new`.** It stamps today's date, which sorts **before** the existing files and breaks the order. Name the file by hand as `20261101000028_what_it_does.sql`, then `...29`, and so on.
- **Two people must never take the same number.** Tell the other person in a message the moment you take one, and merge small and often.
- Every new rule gets a test in `supabase/tests`.

## 5.3 Staying out of each other's way
Two people editing the same file causes pain. A simple split:
- **One of you:** the product work on the shop screens and the database rules (items in Part 8 groups A, B and F of the report).
- **The other:** the base around it (items 1 to 6, 14 and 15 of Part 11: GitHub protection, hosting, test copy, alerts, backups), and then the **new features in new files**: automatic WhatsApp and the staff performance tracker.
- Before starting, say which files or folders you will touch, in a message.
- Pull `development` every morning.

## 5.4 If you use Claude Code or another AI helper
- `CLAUDE.md` is read automatically and holds the rules.
- **Chats are private to each person.** What one helper learned is not known to the other. So at the end of every work session, update `docs/HANDOVER.md` with what changed, what is open and what to do next.
- Ask the helper to read `docs/HANDOVER.md` first.

# 6. Good first tasks (from Part 11 of the report)
1. Set up on his computer and run all the tests.
2. Walk through the app as owner, manager and staff of the bridal shop, on a phone and a computer, and write down anything odd.
3. Take one of: hosting accounts and the test copy; alerts and an uptime check; backups.
4. Then the first piece of new-feature work in its own folder.

# 7. A message you can send him
"Hi [name]. Welcome to Overbooked. Here is the plan. 1) Read `docs/PROJECT_REPORT.docx`, then `docs/PARTNER_ONBOARDING.md`. 2) I have added you to the GitHub repository. Set it up on your computer with the steps in section 3 and run the tests. 3) Work on your own branch from `development` and open a pull request. I merge. 4) Never touch TRENDZ, and never share keys. 5) Tell me which files you are about to change before you start. Let us talk for 30 minutes once a week."

# 8. Before you send this (for the owner)
- [ ] Push the work to GitHub.
- [ ] Turn on protection for `main` and `development`.
- [ ] Put your real GitHub name in `.github/CODEOWNERS`.
- [ ] Add him as a collaborator with Write access.
- [ ] Sign the agreement about who owns the code.
- [ ] Tell him whether the live system exists yet. Today it does not.
