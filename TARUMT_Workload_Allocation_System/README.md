# TARUMT Teaching Workload Allocation System

Distribute teaching responsibilities, track lecturer workloads, compute OT
claims and manage approval workflows — TARUMT Sabah branch.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14+ (App Router), TypeScript, Tailwind |
| Animations | React Bits (react-bits) |
| Charts | Recharts |
| Icons | lucide-react |
| Backend (core API) | Node.js + Express (TypeScript) — separated REST API (port 8000) |
| Backend (engine) | Python 3.11+ / FastAPI (algorithms only) |
| Database | PostgreSQL 15+, managed via psql CLI |
| Styling | Custom design system (Apple + Linear + Modern SaaS) |

## Folder structure

```
TARUMT_Workload_Allocation_System/
  frontend/          Next.js app (src/app pages, components, services, types)
  backend-express/   Express TypeScript REST API (src/app.ts, routes/) — the backend
  backend-python/    FastAPI engine — app/main.py, algorithms/
  database/          schema.sql, migrations/, seeds/
  docs/              system-architecture.md
```

## Port mapping

| Port | Service |
|------|---------|
| 3000 | Next.js frontend |
| 8000 | Express REST API (backend-express) |
| 8001 | Python API (FastAPI) |
| 5432 | PostgreSQL |

## Setup

### Phase 1 — Database (psql CLI only)

```bash
psql --version
psql -U postgres -c "CREATE DATABASE teaching_workload_db;"
psql -U postgres -d teaching_workload_db -f database/schema.sql
psql -U postgres -d teaching_workload_db -f database/seeds/01_reference_data.sql
```

Seeded password for every account: `password123` (bcrypt, generated with
pgcrypto `gen_salt('bf', 10)`). Sample logins: `admin@tarc.edu.my` (admin),
lecturer emails e.g. `ellis.chieng@tarc.edu.my`, part-time e.g. `juramizan@tarc.edu.my`.

### Phase 2 — Frontend

```bash
cd frontend
npm install
npm run dev
```

(From-scratch alternative: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`, then `npm install react-bits lucide-react recharts`.)

### Phase 3 — Express backend (the core API)

```bash
cd backend-express
npm install
npm run dev
```

Health check: `curl http://localhost:8000/api/health`

The frontend calls this backend first and falls back to Next.js route
handlers when the service is not running (`src/services/apiClient.ts`),
mirroring the login page's existing try-primary-then-fallback pattern.

### Phase 4 — Python backend

```bash
cd backend-python
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Health check: `curl http://localhost:8001/health`

## Verify

```bash
psql -U postgres -d teaching_workload_db -c "\dt"
```

Business rules baked into the schema: weekly teaching-hour limits
(Diploma 16h, Bachelor 16h, Bachelor + Diploma 16-17h, Programme Leader
11-12h → OT claim), practical split > 28 students, tutorial split >
36 students, 1 moderator + max 9 samples per course, lab courses track
Lab 1 / Lab 2 / 3rd remarks, academic-year intake suggestion engine (same
intake last year, e.g. 202505 → 202605).

See `docs/system-architecture.md` for architecture, data flow and the design system.
