"""
TARUMT Teaching Workload Allocation System - Python engine (FastAPI).

Algorithm service only: OT calculation, auto-assign, class splitting,
semester suggestions. Talks to PostgreSQL 15+ via psycopg (raw SQL).
No ORM, no Docker.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="TARUMT Workload Allocation Engine",
    version="0.1.0",
    description="OT calc, auto-assign, class split, semester suggestion.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Future: include algorithm routers here, e.g.
#   app.include_router(ot.router,          prefix="/api")
#   app.include_router(auto_assign.router, prefix="/api")
#   app.include_router(class_split.router, prefix="/api")
#   app.include_router(semester_suggestion.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "python-engine"}
