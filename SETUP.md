# Golden Era SafeScore — Setup Guide

## Prerequisites

- Node.js 18+ (you have v24.13.0)
- npm (you have v11.6.2)
- A Supabase account (free tier works)
- An OpenRouter account
- (Optional) FMCSA QCMobile API key — app works without it using mock data for Nationwide (DOT 2533650)

---

## Step 1: Environment variables

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in your credentials. See below for where to get each one.

---

## Step 2: Supabase project

1. Go to **https://app.supabase.com** and create a new project
2. Name it `safescore`, choose a region close to you, set a strong DB password
3. Once created, go to **Project Settings → API**
4. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY`

### Run the database migration

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **+ New query**
3. Open `supabase/migrations/001_initial_schema.sql` from this repo
4. Paste the entire contents into the SQL editor
5. Click **Run**
6. You should see "Success. No rows returned"

### Create the storage bucket

In the Supabase dashboard:
1. Go to **Storage** in the left sidebar
2. Click **+ New bucket**
3. Name: `safescore-documents`
4. Toggle **Public bucket** to OFF (private)
5. Click **Save**

Then add storage policies:
1. Click the `safescore-documents` bucket
2. Go to **Policies**
3. Add policy: Authenticated users can upload to their own `{client_id}/` prefix

---

## Step 3: Create first GEIA staff user

In Supabase → **Authentication → Users**:

1. Click **+ Invite user** (or use the **Add user** button)
2. Enter the staff member's email
3. After the user is created, go to **SQL Editor** and run:

```sql
UPDATE users
SET role = 'geia_admin'
WHERE email = 'your-staff-email@example.com';
```

Or to set role at signup, the `handle_new_user` trigger reads `raw_user_meta_data.role`.
You can use the Supabase Admin API to create a user with metadata:

```bash
# Using Supabase dashboard: Authentication → Users → Add user
# Then update role in SQL editor as shown above
```

---

## Step 4: FMCSA API key (optional for Phase 1)

1. Go to **https://mobile.fmcsa.dot.gov/QCDevsite/**
2. Click **Register** and fill in the form
3. Your API key will be emailed within 1-2 business days
4. Add it to `.env.local` as `FMCSA_API_KEY`

**Without a key:** The app uses mock data for DOT **2533650** (Nationwide Carrier Inc, your pilot client). All dev and demo work can be done without a live key.

---

## Step 5: OpenRouter API key

1. Go to **https://openrouter.ai**
2. Sign up and go to **Keys**
3. Click **+ Create key**
4. Add it to `.env.local` as `OPENROUTER_API_KEY`
5. Add a few dollars of credits — AI assessments cost ~$0.01-0.05 per violation batch

The app uses model `anthropic/claude-sonnet-4-6` via OpenRouter.

---

## Step 6: Run the app

```bash
npm install
npm run dev
```

Open **http://localhost:3000** — you'll be redirected to `/login`.

Sign in with your GEIA staff account, land on the console at `/console`.

---

## Step 7: Run your first assessment

1. In the **Quick Assessment** panel on the console homepage, enter `2533650`
2. You'll see Nationwide Carrier Inc's full safety profile (mock data)
3. Click **Add as SafeScore client** to save them
4. Navigate to the client → **Violations** tab
5. Click **AI assess X pending** to run challengeability analysis (requires OpenRouter key)
6. Check boxes on challengeable violations to see the score impact simulator

---

## Architecture reference

```
app/
├── (auth)/          ← Login page, auth callback
├── (console)/       ← Internal GEIA staff console
│   ├── page.tsx               Client overview + quick assessment
│   ├── assess/[dot]/          Pre-client assessment page
│   ├── clients/[id]/          Client detail + all workbenches
│   └── activity/              Global audit log
├── api/             ← Server-side API routes (FMCSA, analysis, cases, reports)

lib/
├── supabase/        ← Supabase client (browser + server)
├── fmcsa/           ← FMCSA QCMobile API client + Nationwide mock data
├── ai/              ← OpenRouter wrapper
└── analysis/        ← Score impact math, challengeability, prioritization

supabase/
└── migrations/      ← Run this in Supabase SQL editor
```

---

## Phase 2 (coming next)

- Client portal (7 screens + 6-step onboarding wizard)
- FMCSA DataHub bulk file pipeline (violation-level detail from Open Data)
- Stripe subscription billing
- Email notifications (new violations, case updates, deadlines)
- Branded PDF report export
- SAFER/SMS web scraper fallback

---

## Deployment (Vercel)

```bash
# Push to GitHub
git add .
git commit -m "Initial build"
git push origin main

# Then in Vercel:
# 1. Import the GitHub repo
# 2. Add environment variables (same as .env.local but with production values)
# 3. Deploy
```

Set `NEXT_PUBLIC_APP_URL` to your Vercel domain in production.
