# Python engine — FastAPI

Algorithms only: OT calculation, auto-assign, class splitting,
academic-year intake suggestions. PostgreSQL via psycopg (raw SQL), no ORM.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Health check: `curl http://localhost:8001/health`
Expected: `{"status": "ok", "service": "python-engine"}`

Interactive docs: http://localhost:8001/docs

## Planned layout

| Folder | Purpose |
|---|---|
| app/api/ | routers (ot, auto_assign, class_split, intake_suggestion) |
| app/services/ | orchestration + DB access |
| app/algorithms/ | pure functions: OT calc, split rules (P > 28, T > 36), suggestions |
| app/schemas/ | pydantic models |
| tests/ | pytest |

Business rules (function.docx):
- Weekly limits: Diploma 16h, Bachelor 16h, Bachelor + Diploma 16-17h,
  Programme Leader 11-12h -> overtime => OT claim.
- Practical > 28 students -> split. Tutorial > 36 students -> split.
- 1 moderator per course, max 9 samples.
- Academic-year intake suggestion: current 202605 -> suggest last year 202505.
