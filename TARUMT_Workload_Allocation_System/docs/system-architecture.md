# System Architecture — TARUMT Teaching Workload Allocation System

## 1. Architecture diagram (text)

```
                    +---------------------------+
                    |         Browser           |
                    +-------------+-------------+
                                  |
                                  v
                    +---------------------------+
                    |   Next.js Frontend :3000  |   (App Router + React 18 + Tailwind 3)
                    |   services/apiClient.ts   |
                    +------+-------------+------+
                            |             |
            HTTP/JSON :8000 |             | same-origin /api  (fallback only)
                            v             v
      +--------------------------------+  +----------------------------+
      | Express REST API :8000         |  | Next.js route handlers     |
      | backend-express (TypeScript)   |  | (identical behaviour,      |
      |  · auth (bcrypt + HS256 token) |  |  transitional fallback)    |
      |  · dashboard summary           |  +----------------------------+
      |  · lecturers roster + PATCH    |
      |  · hour-limit rules GET/PATCH  |
      |  raw SQL via pg driver         |
      +---------------+----------------+  +----------------------------+
                      |                   | Python API :8001 (FastAPI) |
                      |                   | algorithm engine (parked)  |
                      |                   +----------------------------+
                      v
            +------------------------------------------+
            |        PostgreSQL :5432                  |
            |        teaching_workload_db (UTF-8)      |
            +------------------------------------------+
```

Call order: the browser talks to the **Next.js server (3000)**, whose page
code calls the **Express API (8000) first** and falls back to the same
origin's Next.js route handlers only when the backend is unreachable — so
the UI keeps working even with the backend stopped.

## 2. Data flow / responsibility split

- **Frontend — Next.js 14 + React 18 (port 3000)**
  Pages (Dashboard, Lecturers, module placeholders), the animated sidebar
  with live ⚠ counters, Toasts, and the rules editor. All data calls go
  through `frontend/src/services/apiClient.ts` (Express-first, fallback
  second). Sessions live in `services/auth.ts` + localStorage.
- **Core API — Express.js + TypeScript (port 8000, `backend-express/`)**
    - `POST /api/auth/login` — 4-digit staff code + bcrypt verification,
      HS256-signed 12-hour token (no external auth dependencies).
    - `GET /api/dashboard/summary` — all sidebar/dashboard counters in one SQL
      round-trip (incl. `lecturers.limitAlerts` = stored-limit-pair rows that
      fall outside the current rule's allowed range).
    - `GET /api/lecturers` — roster with department, linked account, embedded
      editable rules, snapshot min/max pair + rule suggestion, drift (custom)
      and out-of-range (⚠) flags.
    - `PATCH /api/lecturers/:staffId` — maintain lecturer details + stored
      limit pair; whitelisted dynamic SET builder, parameterized values,
      0.5–45 h/wk bound check, ≤2 decimals check, min ≤ max, ceiling from
      `MAX(workload_rules.max_hours)`, unique-email → 409.
    - `GET/PATCH /api/workload-rules` — editable role/course min/max pairs,
      transactional bulk update with the same hour validations.
      Same query/validation logic as the Next.js fallback handlers, 1:1 ported.
- **Algorithm engine — Python FastAPI (port 8001, `backend-python/`)**
  Parked `/health` skeleton; will own OT calculation (hours above limits),
  auto-assign, class splitting (practical > 28 students, tutorial > 36),
  historical course suggestion and semester suggestion (same semester last
  year, e.g. 2025/05 → 2024/05).
- Both TypeScript services use **raw SQL through the `pg` driver with
  parameterized queries** (`$1, $2…` — no ORM, no string-built SQL);
  Postgres is managed via `psql` CLI (Docker optional later).

## 3. Database summary

- **Database**: `teaching_workload_db` (UTF-8) on **PostgreSQL 17, port 5432**
- **11 tables**: academic_years, semesters, users, departments, lecturers,
  programmes, subjects, workload_rules (editable hour-limit pairs),
  workloads, workload_details, workload_history (audit table)
- **3 reporting views**: vw_lecturer_workload_summary, vw_subject_allocation,
  vw_department_workload
- **13 foreign keys** (referential integrity), **32 indexes**
- Unique business keys: `uq_semesters_year_code (academic_year_id, semester_code)`,
  `uq_workload_lecturer_semester (lecturer_id, semester_id)`
- **Snapshot limit design**: each lecturer carries a materialized
  `min_limit_hours / max_limit_hours` pair seeded once from the rules, then
  never rewritten by rule edits; pairs drifting from (or outside) the
  current rule's allowed range surface as “Custom” (informational) or the
  ⚠ warning badge (counted by the dashboard summary).

Full DDL: `database/schema.sql`. Reference data: `database/seeds/01_reference_data.sql`.

## 4. Design system summary (theme.docx)

| Token group          | Values                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Font                 | Inter, Helvetica Neue, Arial, sans-serif                                                                                 |
| Surfaces             | background #F5F5F7, surface #FFFFFF, pageBg #FBFBFD, hoverBg #F2F2F7                                                     |
| Primary              | #0071E3, hover #005BB5, light #EAF3FF (active sidebar bg)                                                                |
| Success              | #34C759 / bg #E8F8EE / text #248A3D                                                                                      |
| Warning              | #FF9F0A / bg #FFF4E5 / text #C76B00                                                                                      |
| Error                | #FF3B30 / bg #FDECEC / text #D70015                                                                                      |
| Text                 | #1D1D1F headings, #424245 body, #6E6E73 secondary, #A1A1A6 disabled                                                      |
| Lines                | border #D2D2D7, divider #E5E5EA                                                                                          |
| Spacing (8px system) | xs 4, sm 8, md 16, lg 24, xl 32, xxl 48                                                                                  |
| Radius               | button 10px, card 16px, badge 999px                                                                                      |
| Card shadow          | 0 8px 24px rgba(0, 0, 0, 0.06)                                                                                           |
| Layout               | sidebar 240-280px (white, 1px #E5E5EA), top nav 64px, table rows 56px                                                    |
| Typography           | Dashboard title 32/700/-0.02em, page heading 24/600, section 18/600, card title 16/600, body 14-16/400, secondary 13/400 |

Authoritative tokens: `frontend/tailwind.config.ts` + `frontend/src/lib/theme.ts`.

## 5. Ports

| Port | Service                                          |
| ---- | ------------------------------------------------ |
| 3000 | Next.js frontend                                 |
| 8000 | Express REST API (TypeScript, `backend-express`) |
| 8001 | Python API (FastAPI, algorithm engine)           |
| 5432 | PostgreSQL 17                                    |

## 6. Running locally

```bash
# Terminal 1 — backend
cd backend-express && npm install && npm run dev      # http://localhost:8000

# Terminal 2 — frontend
cd frontend && npm install && npm run dev             # http://localhost:3000

# (later) algorithm engine
cd backend-python && uvicorn app.main:app --reload --port 8001
```

Database (once):

```bash
psql -U postgres -c "CREATE DATABASE teaching_workload_db;"
psql -U postgres -d teaching_workload_db -f database/schema.sql
psql -U postgres -d teaching_workload_db -f database/seeds/01_reference_data.sql
```
