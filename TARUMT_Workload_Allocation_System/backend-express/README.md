# backend-express — TARUMT Workload Allocation System REST API

The separated backend: **Node.js + Express, written in TypeScript**, owning
port **8000**. Serves the same endpoints and behaviour as the frontend's
transitional Next.js route handlers, ported 1:1 (identical SQL, validation,
token scheme and JSON shapes).

## Run

```bash
npm install
npm run dev        # tsx watch src/app.ts → http://localhost:8000
```

Health check: `curl http://localhost:8000/api/health`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | 4-digit code + password (bcrypt, DB-first, DEV fallback) |
| GET | `/api/dashboard/summary` | dashboard + sidebar rail counters |
| GET | `/api/lecturers` | staff roster + embedded rules + limit flags |
| PATCH | `/api/lecturers/:staffId` | maintain lecturer details + stored limit pair |
| GET | `/api/workload-rules` | editable hour-limit rules |
| PATCH | `/api/workload-rules` | bulk-update rule min/max pairs (transactional) |

## Configuration (`.env`)

| Key | Meaning |
|---|---|
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | PostgreSQL connection (same DB as the seeds) |
| `PORT` | HTTP port (default 8000) |
| `AUTH_SECRET` | JWT signing secret — keep identical to the frontend's so tokens stay interchangeable |

## Frontend wiring

`frontend/src/services/apiClient.ts` tries this backend first and falls back
to the same-origin Next.js route handlers on network failure; the login page
has the same pattern built into `services/auth.ts`. Start this service and
every data call in the UI flows through **frontend → Express → PostgreSQL**.

## Next steps

- Authorization headers on every call + `verifyJwt` guard (RBAC) — `src/token.ts` is ready.
- Docker Compose (frontend + backend + Postgres + Python engine) to match the architecture figure.
