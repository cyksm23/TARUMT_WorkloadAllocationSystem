# Automatic course assignment

## Use

1. Record lecturer specializations in **Lecturers → Add staff / Edit lecturer → Specialization**.
2. Open **Course Assignment → Auto Assign**.
3. Select one coded academic year and optionally a programme; the dialog starts with the page's filters. Set the four **Matching priorities** in the desired order. Selecting an already-used criterion swaps its position, so duplicates are impossible.
4. Generate a preview, review each lecturer, matching evidence and projected weekly hours, then **Confirm & save**.

Only active, unassigned courses are considered. Each suggested lecturer takes all three L/T/P slots, matching manual initial assignment. Existing or partially assigned courses are preserved. Courses without a suitable lecturer remain unassigned with a reason.

## Matching and capacity

- The default order is **workload → specialization → interest → previous courses**. Criteria are compared in order; later criteria break ties rather than overriding earlier ones through a weighted percentage. The Programme Leader can reorder all four in the dialog.
- Workload favours staff below their minimum-hours target, then the lowest projected share of maximum weekly hours. Capacity checks always apply, regardless of the selected order.
- Specialization matches use `lecturers.specialization`; qualifications are not silently treated as specialization evidence.
- Interest matches use `lecturers.area_of_interest`.
- Previous-course evidence comes from saved positive-hour L/T/P assignments in terms that ended **before both the selected term starts and the current database date**. Rejected, current, future, zero-hour and non-teaching records do not count. L/T/P slots for the same lecturer/course/term count once.
- Teaching-history matching prefers the same course code/title over related subject topics. The preview lists supporting course names and academic years, or explicitly states that no history is recorded. These are earlier allocation records, not independent proof that teaching took place or a qualification certification; unrecorded/deleted experience is not guessed.
- A lecturer must have at least one relevant recorded specialization, interest or earlier course assignment; spare hours alone never justify an unrelated assignment.
- Matching uses an explicit topic/alias dictionary and meaningful keywords in course titles. Broad computing specializations receive a weaker, clearly labelled fallback match. This is a deterministic heuristic, not a qualification certification or guaranteed globally optimal allocation.
- Lecturers must be active and cannot exceed `max_limit_hours` in the selected coded academic year. Minimum hours are a target, not a forced assignment requirement.
- The existing policy of 3 Bachelor / 4 Diploma distinct courses is retained, including its **across-all-years** counting scope.
- Weekly hours retain the existing assignment calculation: lecture + tutorial + practical once, without a class-group multiplier. Other recorded teaching activities contribute to existing workloads.
- Pending/approved workload headers are not changed by auto-assignment.

## Persistence and concurrency

`POST /api/allocations/auto-assign` accepts:

```json
{ "action": "preview", "academicYearId": 2, "programmeCode": null, "priorities": ["workload", "specialization", "interest", "history"] }
```

The response includes `plan.previewToken`. To save the reviewed suggestions:

```json
{ "action": "commit", "academicYearId": 2, "programmeCode": null, "priorities": ["workload", "specialization", "interest", "history"], "previewToken": "<token from preview>" }
```

Every provided priority must appear exactly once; omitted priorities use the default order. Preview is read-only. Confirm reloads and fingerprints the current database data, generated decisions and selected priorities, refusing changed data or a changed order with HTTP 409. Lecturer ids and hour totals from the browser are never used as allocation authority. The complete batch is saved in one PostgreSQL transaction to `workloads` and `workload_details`, including the chosen order, profile matches and earlier-course evidence in the notes; failures roll back all rows.

Manual and automatic assignment writers share a PostgreSQL transaction-level advisory lock. Manual saves also enforce the same per-term maximum-hours calculation. Both Express and the Next fallback import the canonical engine from `backend-express/src/services`, so frontend builds should retain the repository's frontend/backend directory layout.

## Migration and tests

For an existing database, run `database/migrations/20261024_remove_lecturer_major_of_study.sql`. It preserves a nonblank legacy major in `specialization` only when specialization is blank, then drops the redundant column. The migration is idempotent; fresh databases contain only `specialization`.

In `backend-express`, run `npm test`. PostgreSQL integration tests are opt-in through `TEST_DATABASE_URL`; they use session-local temporary tables only and do not modify real lecturer/course/assignment rows.

## Icon credit

The Auto Assign icon is [Auto Assign by Mohamed Riyaz Ali from Noun Project](https://thenounproject.com/icon/auto-assign-682368/), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The supplied PNG was recoloured white without changing its transparency or shape. The local asset and attribution are in `frontend/public/icons/`.
