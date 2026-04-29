# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BJJ Flow Manager** — Multi-tenant SaaS for Brazilian Jiu-Jitsu academy management. Tracks students, attendance, belt progression, payments, and class schedules.

## Development Commands

```bash
# Development (run both concurrently)
npm run server      # Express API on :3001
npm run vite:dev    # React frontend on :5173 (proxies /api → :3001)

# Alternative: Next.js dev (combined, port 3000)
npm run dev

# Build & Production
npm run vite:build                   # Build frontend to /dist
NODE_ENV=production npm run server   # Express serves /dist + /api

# Testing
npm run test        # Run tests once (Vitest)
npm run test:watch  # Watch mode
```

## Architecture

### Dual Build System

The project uses **Vite for development** and **Next.js + Express for production**:
- `npm run vite:dev` — Vite dev server (fast HMR, proxies `/api` to Express on :3001)
- `npm run dev` — Next.js dev server (combined mode)
- Production: Vite builds to `/dist`, Express serves static files + API routes

### Frontend (React SPA)

Entry: `src/main.tsx` → wraps in `<AuthProvider>` → renders `src/App.tsx`

**Routing** (`src/App.tsx`): React Router v7 with `<RequireAuth>` guards. Public routes: `/login`, `/signup`, `/forgot-password`, `/checkin/:organizationId` (kiosk), `/meu-qr/*`. Protected routes require auth + 24h session validity.

**Auth** (`src/lib/AuthContext.tsx`): Central context providing `user`, `tenant` (org info), and `role` (admin/professor). Uses Supabase Auth + stores session expiry in localStorage. `handleSupabaseAuthError()` centralizes JWT/auth error detection with auto sign-out.

**Data fetching**: Direct Supabase SDK calls in `useEffect` hooks within components. Supabase client at `src/lib/supabaseClient.ts` uses `VITE_SUPABASE_ANON_KEY`.

**Next.js integration**: Pages in `/pages/` are catch-all routes that render the React SPA with `ssr: false`. Next.js is transparent — it's just a shell + static file server.

### Backend (Express + Supabase)

Express server at `server/index.js` handles sensitive API operations using `SUPABASE_SERVICE_ROLE_KEY`:
- `POST /api/checkin` — Validates payment status + capacity, records attendance, increments `total_classes`
- `POST /api/awardBelt` — Promotes student belt/degree, logs to `belt_history`
- `POST /api/adminResetPassword` — Admin-initiated password reset
- `POST /api/forgotPassword` — Self-service password recovery

### Core Business Logic

`src/lib/beltLogic.ts` — **Framework-agnostic** module (no React imports). Contains:
- `evaluateBeltProgress(student, attendances, config)` — Computes belt/degree readiness from attendance count + time windows
- `filterAttendancesSince(attendances, date)` — Time-windowed filtering
- `DEFAULT_CLUB_CONFIG` — 30 classes per degree, belt-specific month requirements (6–36)
- Belt order: Branca → Azul → Roxa → Marrom → Preta

### Database (Supabase PostgreSQL)

Multi-tenant with Row-Level Security. Key tables:
- `organizations` + `profiles` — Multi-tenancy: every query must scope by `organization_id`
- `students` — Belt, degree, `total_classes`, contact (JSONB)
- `attendances` — Check-ins with session capacity tracking
- `classes` — Modality, professor, schedule
- `belt_history` — Promotion audit log
- `payments` — Status: `paid` / `pending` / `late` / `delinquent`
- `settings` — Per-org configuration

Schema: run `supabase/schema.sql` in Supabase SQL editor to bootstrap.

### Environment Variables

See `.env.example`. Critical:
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` — Client-side (safe to expose)
- `SUPABASE_SERVICE_ROLE_KEY` — Server-side only, never in client code
- `SUPABASE_DB_URL` — Direct DB connection for Express

### UI Stack

Tailwind CSS + shadcn/ui + Radix UI primitives. Custom brand colors in `tailwind.config.cjs`: `primary` (royal blue), `gold`, `brandBlack`. Icons from Lucide React.
