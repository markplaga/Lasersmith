# Turning on accounts (Supabase)

Accounts and the shared library are built and tested. They switch on when the site is built with
your Supabase project's URL and public (anon) key. Until then the site works exactly as before, with
no sign-in button. The Claude artifact never shows accounts.

## 1. Create the project

1. Go to supabase.com and create a project (any region; the free tier is fine to start).
2. Open **SQL Editor**, paste all of `supabase/migrations/20261118000000_init.sql` and run it.
   (Or, with the Supabase CLI: `supabase link` then `supabase db push`.)
   This creates the tables, the thumbnail bucket and the row-level security rules.

## 2. Sign-in settings

In **Authentication > URL Configuration**:

- **Site URL**: your Netlify address, for example `https://lasersmith.netlify.app`.
- **Redirect URLs**: add the same address, plus `http://localhost:8080` if you test locally.

Email magic links work straight away. For **Google**: Authentication > Providers > Google, then
paste a Google OAuth client ID and secret. The client is made in Google Cloud Console >
APIs & Services > Credentials, with Supabase's callback URL (shown on that page) as its redirect URI.

## 3. Give the keys to Netlify

In **Project Settings > API**, copy the **Project URL** and the **anon public** key. In Netlify, open
**Site configuration > Environment variables** and add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL, e.g. `https://abcd1234.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon public key |

Redeploy. A **Sign in** button appears at the top right.

The anon key is meant to be public: it is shipped in the page, and the row-level security rules
decide what each person can read and change. Never put the **service_role** key in Netlify or in
the page.

## What people can do

- Sign in with an email link or Google.
- **Save to my account**: saves the current design with its parameters (for a library design) or its
  generator (for a design made with Claude). It starts private.
- Share it as **Anyone with the link** or **Public** (listed under Community in the library). Only a
  design with no errors under Checks can be shared. Each share records an immutable version.
- **Save a copy** of anyone's shared design (a fork, which links back to the original).
- **Report** a shared design. Reports go to the `reports` table, which only you can read, from
  the Supabase dashboard.
- **Download all my data** from the account menu. Designs made in the browser before signing in can
  be saved to the account from the same menu.

## Checking the rules

`npm run test:db` (with a local Postgres 16, `PGHOST`/`PGUSER` set) applies the migration to a
throwaway database and checks every row-level security rule. CI runs the same check.
