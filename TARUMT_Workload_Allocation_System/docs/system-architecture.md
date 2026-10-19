# System Architecture — TARUMT Teaching Workload Allocation System

## 1. Architecture diagram (text)

```
                    +---------------------------+
                    |         Browser           |
                    +-------------+-------------+
                                  |
                                  v
                    +---------------------------+
                    |   Next.js Frontend :3000  |   (App Router + Tailwind)
                    +------+-------------+------+
                           |             |
            JSON over HTTP |             | JSON over HTTP
                           v             v
      +--------------------+---+   +-----+----------------------+
      | PHP API :8000          |   | Python API :8001           |
      | (auth, CRUD, workflow) |   | (OT calc, auto-assign,     |
      | raw PDO                |   |  class split, suggestions) |
      +-----------+------------+   +-----------+----------------+
                  |                            |
                  v                            v
           +------------------------------------------+
           |        PostgreSQL :5432                  |
           |        teaching_workload_db (UTF-8)      |
           +------------------------------------------+
```

## 2. Data flow / responsibility split

- **Auth + CRUD via PHP (:8000)** — login (JWT), lecturers, courses,
  programmes, allocations, workload submit/approve workflow
  (DRAFT → PENDING → APPROVED / REJECTED), audit rows into `workload_history`.
- **Heavy compute via Python (:8001)** — OT calculation (hours above limits:
  16h Diploma, 16h Bachelor, 16-17h Bachelor + Diploma, 11-12h Programme
  Leader), auto-assign, class splitting (practical > 28 students,
  tutorial > 36 students), semester suggestion (same semester last year,
  e.g. current 2025/05 → last year 2024/05).
- Both services use **raw SQL** against the same PostgreSQL database
  (PDO / psycopg). No ORM, no Docker. DB managed via `psql` CLI only.

## 3. Database summary

- **Database**: `teaching_workload_db` (UTF-8)
- **9 tables**: academic_years, semesters, users, departments, lecturers,
  programmes, subjects, workloads, workload_details (+ workload_history audit)
- **3 views**: vw_lecturer_workload_summary, vw_subject_allocation,
  vw_department_workload
- **11 indexes**: 7 FK/status indexes, 2 unique-lookup indexes,
  2 partial indexes on `is_active` (semesters, academic_years)
- Unique business keys: `uq_semesters_year_code (academic_year_id, semester_code)`,
  `uq_workload_lecturer_semester (lecturer_id, semester_id)`.

Full DDL: `database/schema.sql`. Reference data: `database/seeds/01_reference_data.sql`.

## 4. Design system summary (theme.docx)

| Token group | Values |
|---|---|
| Font | Inter, Helvetica Neue, Arial, sans-serif |
| Surfaces | background #F5F5F7, surface #FFFFFF, pageBg #FBFBFD, hoverBg #F2F2F7 |
| Primary | #0071E3, hover #005BB5, light #EAF3FF (active sidebar bg) |
| Success | #34C759 / bg #E8F8EE / text #248A3D |
| Warning | #FF9F0A / bg #FFF4E5 / text #C76B00 |
| Error | #FF3B30 / bg #FDECEC / text #D70015 |
| Text | #1D1D1F headings, #424245 body, #6E6E73 secondary, #A1A1A6 disabled |
| Lines | border #D2D2D7, divider #E5E5EA |
| Spacing (8px system) | xs 4, sm 8, md 16, lg 24, xl 32, xxl 48 |
| Radius | button 10px, card 16px, badge 999px |
| Card shadow | 0 8px 24px rgba(0, 0, 0, 0.06) |
| Layout | sidebar 240-280px (white, 1px #E5E5EA), top nav 64px, table rows 56px |
| Typography | Dashboard title 32/700/-0.02em, page heading 24/600, section 18/600, card title 16/600, body 14-16/400, secondary 13/400 |

Authoritative tokens: `frontend/tailwind.config.ts` + `frontend/src/lib/theme.ts`.

## 5. Ports

| Port | Service |
|------|---------|
| 3000 | Next.js frontend |
| 8000 | PHP API |
| 8001 | Python API (FastAPI) |
| 5432 | PostgreSQL |
