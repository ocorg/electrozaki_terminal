# ⚡ Electro Zaki — Terminal v3.0

Business management system for Electro Zaki phone store, built with Next.js + Supabase + Vercel.

## Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Database:** Supabase (PostgreSQL + Auth + Realtime + RLS)
- **Deployment:** Vercel (auto-deploy from GitHub)
- **PWA:** Installable on Android/iOS (next-pwa)

## Setup

### 1. Database (Supabase)
1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase_schema.sql`
3. Go to **Authentication > Users** → create 3 users (owner, manager, staff)
4. For each user, set `app_metadata.role` in the Supabase Dashboard

### 2. Local Development
```bash
cp .env.local.example .env.local
# Fill in your Supabase keys
npm run dev
```

### 3. Deploy to Vercel
1. Push to GitHub
2. Connect repo in Vercel dashboard
3. Add environment variables (same as .env.local)
4. Deploy

## Build Phases
- ✅ Phase 1 — Google Sheets foundation (complete)
- ✅ Phase 2 — Supabase schema (complete — run supabase_schema.sql)
- ✅ Phase 3 — Project scaffold (complete — this repo)
- 🔲 Phase 4 — Core modules (POS, Stock, Repairs)
- 🔲 Phase 5 — Operations (Clients, Suppliers, Expenses)
- 🔲 Phase 6 — Intelligence (Dashboard, Caisse, Reports)
- 🔲 Phase 7 — Print & Polish (Labels, Receipts, PWA)

## Commands
```bash
npm run dev      # Local dev (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```
