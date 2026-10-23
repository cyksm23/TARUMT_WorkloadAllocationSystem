-- ============================================================
-- TARUMT Teaching Workload Allocation System
-- PostgreSQL 15+ schema  |  DB: teaching_workload_db
-- 11 tables, 3 views, 11 indexes
-- Run order: tables -> indexes -> views
-- ============================================================

BEGIN;

-- 1) academic_years ------------------------------------------
CREATE TABLE academic_years (
    id          SERIAL PRIMARY KEY,
    year_code   VARCHAR(20)  NOT NULL UNIQUE,
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    is_active   BOOLEAN      DEFAULT FALSE,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW()
);

-- 2) academic_year_terms — the coded intake terms (202605 · May 2026, …)
--    each belonging to an academic year
CREATE TABLE academic_year_terms (
    id               SERIAL PRIMARY KEY,
    academic_year_id INTEGER      NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    term_name        VARCHAR(50)  NOT NULL,
    term_code        VARCHAR(20)  NOT NULL,
    start_date       DATE         NOT NULL,
    end_date         DATE         NOT NULL,
    week_count       INTEGER      DEFAULT 14,
    is_active        BOOLEAN      DEFAULT FALSE,
    created_at       TIMESTAMP    DEFAULT NOW(),
    updated_at       TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT uq_academic_year_terms_code UNIQUE (academic_year_id, term_code)
);

-- 3) users ---------------------------------------------------
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email         VARCHAR(150) UNIQUE,
    role          VARCHAR(20)  NOT NULL DEFAULT 'lecturer',
        CHECK (role IN ('admin','coordinator','lecturer','hod')),
    is_active     BOOLEAN      DEFAULT TRUE,
    last_login    TIMESTAMP    NULL,
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

-- 4) departments --------------------------------------------
CREATE TABLE departments (
    id              SERIAL PRIMARY KEY,
    department_code VARCHAR(20)  NOT NULL UNIQUE,
    department_name VARCHAR(200) NOT NULL,
    description     TEXT         NULL,
    is_active       BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);
-- 5) lecturers ----------------------------------------------
CREATE TABLE lecturers (
    id                 SERIAL PRIMARY KEY,
    staff_id           VARCHAR(30)  NOT NULL UNIQUE,
    user_id            INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    department_id      INTEGER      REFERENCES departments(id),
    full_name          VARCHAR(200) NOT NULL,
    email              VARCHAR(150) UNIQUE,
    phone_number       VARCHAR(20)  NULL,
    position           VARCHAR(100) NULL,
    is_pl              BOOLEAN      NOT NULL DEFAULT FALSE,
    qualifications     TEXT         NULL,          -- e.g. 'BCompSc (UMP), MSc (UMS)'
    specialization     TEXT         NULL,
    area_of_interest   TEXT         NULL,
    employment_type    VARCHAR(30)  NOT NULL DEFAULT 'FULL_TIME',
        CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACT')),
    is_active          BOOLEAN      DEFAULT TRUE,
    max_workload_hours NUMERIC(5,2) DEFAULT 40.00,  -- legacy; superseded by min/max_limit_hours
    -- Materialized per-lecturer limits: seeded from workload_rules, then
    -- snapshot-stable. Rules edits NEVER rewrite these; stored pairs that
    -- no longer match the lecturer's rule (or exceed the rules ceiling)
    -- surface the red warning badge for manual modification.
    min_limit_hours    NUMERIC(5,2) NOT NULL,
    max_limit_hours    NUMERIC(5,2) NOT NULL,
    created_at         TIMESTAMP    DEFAULT NOW(),
    updated_at         TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT ck_lecturers_limit_range CHECK (min_limit_hours <= max_limit_hours)
);

-- 6) programmes ---------------------------------------------
CREATE TABLE programmes (
    id             SERIAL PRIMARY KEY,
    programme_code VARCHAR(30)  NOT NULL UNIQUE,
    programme_name VARCHAR(200) NOT NULL,
    department_id  INTEGER      REFERENCES departments(id),
    level          VARCHAR(20)  NULL,   -- Bachelor / Master / Diploma
    duration_years INTEGER      DEFAULT 3,
    is_active      BOOLEAN      DEFAULT TRUE,
    created_at     TIMESTAMP    DEFAULT NOW(),
    updated_at     TIMESTAMP    DEFAULT NOW()
);

-- 7) subjects ----------------------------------------------
CREATE TABLE subjects (
    id              SERIAL PRIMARY KEY,
    subject_code    VARCHAR(30)  NOT NULL UNIQUE,
    subject_name    VARCHAR(200) NOT NULL,
    programme_id    INTEGER      REFERENCES programmes(id),
    academic_year_id INTEGER     REFERENCES academic_year_terms(id),
    credit_hours    NUMERIC(4,1) DEFAULT 3.0,
    lecture_hours   NUMERIC(4,1) DEFAULT 2.0,
    tutorial_hours  NUMERIC(4,1) DEFAULT 1.0,
    practical_hours NUMERIC(4,1) DEFAULT 0.0,
    total_hours     NUMERIC(4,1) DEFAULT 3.0,
    tutorial_students  INTEGER     NULL,      -- headcount in tutorial classes
    practical_students INTEGER     NULL,      -- headcount in practical classes
    student_count   INTEGER      DEFAULT 0,
    group_count     INTEGER      DEFAULT 1,
    is_active       BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);

-- 8) workloads ---------------------------------------------
CREATE TABLE workloads (
    id                    SERIAL PRIMARY KEY,
    lecturer_id           INTEGER      NOT NULL REFERENCES lecturers(id) ON DELETE CASCADE,
    academic_year_id      INTEGER      NOT NULL REFERENCES academic_year_terms(id) ON DELETE RESTRICT,
    total_allocated_hours NUMERIC(5,2) DEFAULT 0.00,
    status                VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
        CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED')),
    approved_by           INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    approved_at           TIMESTAMP    NULL,
    remarks               TEXT         NULL,
    created_at            TIMESTAMP    DEFAULT NOW(),
    updated_at            TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT uq_workload_lecturer_year UNIQUE (lecturer_id, academic_year_id)
);

-- 9) workload_details --------------------------------------
CREATE TABLE workload_details (
    id            SERIAL PRIMARY KEY,
    workload_id   INTEGER      NOT NULL REFERENCES workloads(id) ON DELETE CASCADE,
    subject_id    INTEGER      NOT NULL REFERENCES subjects(id),
    activity_type VARCHAR(30)  NOT NULL,
        CHECK (activity_type IN ('LECTURE','TUTORIAL','PRACTICAL','LAB','PROJECT_SUPERVISION','THESIS_SUPERVISION','OTHER')),
    group_name    VARCHAR(50)  NULL,
    student_count INTEGER      DEFAULT 0,
    hours_per_week NUMERIC(5,2) NOT NULL,
    total_hours   NUMERIC(6,2) NOT NULL,
    notes         TEXT         NULL,
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

-- 10) workload_history -------------------------------------
CREATE TABLE workload_history (
    id          SERIAL PRIMARY KEY,
    workload_id INTEGER   NOT NULL REFERENCES workloads(id) ON DELETE CASCADE,
    changed_by  INTEGER   REFERENCES users(id),
    change_type VARCHAR(30) NOT NULL,   -- CREATED/UPDATED/APPROVED/REJECTED
    old_value   JSONB     NULL,
    new_value   JSONB     NULL,
    changed_at  TIMESTAMP DEFAULT NOW()
);

-- 11) workload_rules ----------------------------------------
-- Role / course-based hour limits (editable by the PL). A lecturer's
-- limits resolve in priority order: the Programme Leader ROLE rule wins;
-- otherwise the COURSES rules match the programme levels actually taught
-- (Bachelor only / Diploma only / both); DEFAULT covers staff with no
-- assignments yet. min/max pairs are editable per rule.
CREATE TABLE workload_rules (
    rule_key   VARCHAR(30) PRIMARY KEY,
    label      VARCHAR(100) NOT NULL,
    basis      VARCHAR(20)  NOT NULL DEFAULT 'COURSES',
        CHECK (basis IN ('ROLE','COURSES','GLOBAL')),
    priority   INTEGER      NOT NULL DEFAULT 10,
    min_hours  NUMERIC(5,2) NOT NULL,
    max_hours  NUMERIC(5,2) NOT NULL,
    updated_at TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT ck_rule_range CHECK (min_hours <= max_hours)
);

-- 12) class_size_rules ---------------------------------------
-- Flexible class-size limits (editable by the PL). A TUTORIAL / PRACTICAL
-- class whose headcount exceeds the limit splits into groups; the course
-- dialog derives the group count from these rules at any time.
CREATE TABLE class_size_rules (
    class_type     TEXT PRIMARY KEY,
        CHECK (class_type IN ('TUTORIAL','PRACTICAL')),
    limit_students INTEGER NOT NULL,
        CHECK (limit_students > 0 AND limit_students <= 500),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO workload_rules (rule_key, label, basis, priority, min_hours, max_hours) VALUES
  ('PL',            'Programme Leader (role)',     'ROLE',     1, 12, 20),
  ('BACHELOR_ONLY', 'Teaching Bachelor only',      'COURSES', 10, 16, 20),
  ('DIPLOMA_ONLY',  'Teaching Diploma only',       'COURSES', 10, 18, 20),
  ('BOTH',          'Teaching Diploma & Bachelor', 'COURSES', 10, 17, 20),
  ('DEFAULT',       'No courses assigned yet',     'GLOBAL',  99, 12, 20);

-- ============================================================
-- INDEXES (11)
-- ============================================================CREATE INDEX idx_lecturers_department       ON lecturers(department_id);
CREATE INDEX idx_lecturers_staff_id         ON lecturers(staff_id);
CREATE INDEX idx_subjects_programme         ON subjects(programme_id);
CREATE INDEX idx_subjects_academic_year     ON subjects(academic_year_id);
CREATE INDEX idx_workloads_lecturer         ON workloads(lecturer_id);
CREATE INDEX idx_workloads_academic_year    ON workloads(academic_year_id);
CREATE INDEX idx_workloads_status           ON workloads(status);
CREATE INDEX idx_workload_details_workload  ON workload_details(workload_id);
CREATE INDEX idx_workload_details_subject   ON workload_details(subject_id);
CREATE INDEX idx_academic_year_terms_active ON academic_year_terms(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_academic_years_active      ON academic_years(is_active) WHERE is_active = TRUE;

-- ============================================================
-- FUNCTIONS (1)
-- ============================================================
-- Future academic years generate themselves ahead of time:
-- ensure_academic_year_horizon() creates the next academic year with its
-- three coded terms (e.g. 2028/2029 → 202805, 202809, 202901) whenever the
-- last seeded intake ends within ~6 months. Codes derive Y05 / Y09 / (Y+1)01,
-- starts follow the intake pattern (2nd Mon May, 3rd Mon Sep, 2nd Mon Jan),
-- 14 weeks each, all generated rows inactive. The course directory endpoint
-- calls this on every read, so the catalogue never runs out of future
-- academic years without any manual step.
CREATE FUNCTION ensure_academic_year_horizon(
    p_horizon DATE DEFAULT CURRENT_DATE + 180
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_last_end  DATE;
    v_last_code TEXT;
    v_base_year INTEGER;        -- the academic year about to be generated
    v_year_code TEXT;
    v_year_id   INTEGER;
    v_dow       INTEGER;        -- weekday of a month's 1st (0=Sun..6=Sat)
    v_may_start    DATE;
    v_sept_start   DATE;
    v_jan_start    DATE;
    v_code      TEXT;
    v_name      TEXT;
    v_created   INTEGER := 0;
BEGIN
    SELECT COALESCE(MAX(end_date), DATE '1970-01-01'),
           (SELECT MAX(term_code) FROM academic_year_terms)
      INTO v_last_end, v_last_code
      FROM academic_year_terms;

    -- nothing seeded yet — the reference-data seeds own that job
    IF v_last_code IS NULL THEN
        RETURN 0;
    END IF;

    -- next academic year starts in Y = code year of the last intake,
    -- unless the last intake was a January term (then Y is that year)
    v_base_year := SUBSTRING(v_last_code, 1, 4)::INTEGER;
    IF v_last_code NOT LIKE '____01' THEN
        v_base_year := v_base_year + 1;
    END IF;

    WHILE v_last_end < p_horizon AND v_created < 5 LOOP
        v_year_code := v_base_year::TEXT || '/' || (v_base_year + 1)::TEXT;

        /* intake starts (2nd Monday of May, 3rd Monday of September,
           2nd Monday of January) — calendar math only */
        v_dow := EXTRACT(DOW FROM make_date(v_base_year, 5, 1))::INTEGER;
        v_may_start := make_date(v_base_year, 5, 1) + ((8 - v_dow) % 7) + 7;
        v_dow := EXTRACT(DOW FROM make_date(v_base_year, 9, 1))::INTEGER;
        v_sept_start := make_date(v_base_year, 9, 1) + ((8 - v_dow) % 7) + 14;
        v_dow := EXTRACT(DOW FROM make_date(v_base_year + 1, 1, 1))::INTEGER;
        v_jan_start := make_date(v_base_year + 1, 1, 1) + ((8 - v_dow) % 7) + 7;

        /* academic year row: spans May intake to January intake */
        INSERT INTO academic_years (year_code, start_date, end_date, is_active)
        VALUES (v_year_code, v_may_start, v_jan_start + 90, FALSE)
        ON CONFLICT (year_code) DO NOTHING;

        SELECT id INTO v_year_id FROM academic_years WHERE year_code = v_year_code;

        /* May intake */
        v_code := v_base_year::TEXT || '05';
        v_name := 'May ' || v_base_year::TEXT;
        INSERT INTO academic_year_terms
            (academic_year_id, term_name, term_code, start_date, end_date, week_count, is_active)
        VALUES (v_year_id, v_name, v_code, v_may_start, v_may_start + 90, 14, FALSE)
        ON CONFLICT (academic_year_id, term_code) DO NOTHING;

        /* September intake */
        v_code := v_base_year::TEXT || '09';
        v_name := 'September ' || v_base_year::TEXT;
        INSERT INTO academic_year_terms
            (academic_year_id, term_name, term_code, start_date, end_date, week_count, is_active)
        VALUES (v_year_id, v_name, v_code, v_sept_start, v_sept_start + 90, 14, FALSE)
        ON CONFLICT (academic_year_id, term_code) DO NOTHING;

        /* January intake of the following calendar year */
        v_code := (v_base_year + 1)::TEXT || '01';
        v_name := 'January ' || (v_base_year + 1)::TEXT;
        INSERT INTO academic_year_terms
            (academic_year_id, term_name, term_code, start_date, end_date, week_count, is_active)
        VALUES (v_year_id, v_name, v_code, v_jan_start, v_jan_start + 90, 14, FALSE)
        ON CONFLICT (academic_year_id, term_code) DO NOTHING;

        v_created   := v_created + 1;
        v_base_year := v_base_year + 1;
        v_last_end  := (SELECT MAX(end_date) FROM academic_year_terms
                          WHERE academic_year_id = v_year_id);
    END LOOP;

    RETURN v_created;
END;
$$;

-- ============================================================
-- VIEWS (3)
-- ============================================================
-- a) lecturer workload summary with utilization %
-- Limits resolve from workload_rules: ROLE rule (PL) wins, otherwise the
-- COURSES rule matching the programme levels taught.
CREATE VIEW vw_lecturer_workload_summary AS
WITH taught_levels AS (
    SELECT w.lecturer_id,
           array_agg(DISTINCT UPPER(p.level)) AS levels
    FROM workloads w
    JOIN workload_details wd ON wd.workload_id = w.id
    JOIN subjects s          ON s.id = wd.subject_id
    JOIN programmes p        ON p.id = s.programme_id
    WHERE p.level IS NOT NULL
    GROUP BY w.lecturer_id
),
resolved AS (
    SELECT l.id AS lecturer_id,
           CASE
             WHEN l.is_pl THEN 'PL'
             WHEN 'BACHELOR' = ANY(t.levels) AND 'DIPLOMA' = ANY(t.levels) THEN 'BOTH'
             WHEN 'BACHELOR' = ANY(t.levels) THEN 'BACHELOR_ONLY'
             WHEN 'DIPLOMA'  = ANY(t.levels) THEN 'DIPLOMA_ONLY'
             ELSE 'DEFAULT'
           END AS rule_key
    FROM lecturers l
    LEFT JOIN taught_levels t ON t.lecturer_id = l.id
)
SELECT
    l.id  AS lecturer_id,
    l.staff_id,
    l.full_name,
    l.employment_type,
    r.rule_key,
    rr.label              AS rule_label,
    rr.min_hours          AS rule_min_hours,
    rr.max_hours          AS rule_max_hours,
    l.min_limit_hours     AS min_workload_hours,
    l.max_limit_hours     AS max_workload_hours,
    d.department_code,
    d.department_name,
    ay.year_code,
    t.id  AS academic_year_id,
    t.term_code,
    w.id  AS workload_id,
    w.total_allocated_hours,
    w.status,
    ROUND((w.total_allocated_hours / NULLIF(l.max_limit_hours,0)) * 100, 2) AS utilization_pct
FROM lecturers l
JOIN resolved         r  ON r.lecturer_id = l.id
JOIN workload_rules   rr ON rr.rule_key = r.rule_key
LEFT JOIN departments   d  ON d.id = l.department_id
LEFT JOIN workloads     w  ON w.lecturer_id = l.id
LEFT JOIN academic_year_terms t ON t.id = w.academic_year_id
LEFT JOIN academic_years ay ON ay.id = t.academic_year_id;

-- b) per-lecturer subject allocation with activity breakdown
CREATE VIEW vw_subject_allocation AS
SELECT
    wd.id            AS workload_detail_id,
    l.id             AS lecturer_id,
    l.staff_id,
    l.full_name,
    ay.year_code,
    t.term_code,
    sub.id           AS subject_id,
    sub.subject_code,
    sub.subject_name,
    p.programme_code,
    p.programme_name,
    wd.activity_type,
    wd.group_name,
    wd.student_count,
    wd.hours_per_week,
    wd.total_hours
FROM workload_details wd
JOIN workloads  w   ON w.id = wd.workload_id
JOIN lecturers  l   ON l.id = w.lecturer_id
JOIN subjects   sub ON sub.id = wd.subject_id
LEFT JOIN programmes p ON p.id = sub.programme_id
JOIN academic_year_terms t ON t.id = w.academic_year_id
JOIN academic_years ay ON ay.id = t.academic_year_id;

-- c) aggregated workload stats per department
CREATE VIEW vw_department_workload AS
SELECT
    d.id AS department_id,
    d.department_code,
    d.department_name,
    COUNT(DISTINCT l.id)                       AS lecturer_count,
    COUNT(DISTINCT w.id)                       AS workload_count,
    COALESCE(SUM(w.total_allocated_hours), 0)  AS total_allocated_hours,
    COALESCE(ROUND(AVG(w.total_allocated_hours), 2), 0) AS avg_allocated_hours,
    COUNT(wd.id)                               AS allocation_detail_count
FROM departments d
LEFT JOIN lecturers        l  ON l.department_id = d.id
LEFT JOIN workloads        w  ON w.lecturer_id = l.id
LEFT JOIN workload_details wd ON wd.workload_id = w.id
LEFT JOIN subjects         s  ON s.id = wd.subject_id
GROUP BY d.id, d.department_code, d.department_name;

COMMIT;

