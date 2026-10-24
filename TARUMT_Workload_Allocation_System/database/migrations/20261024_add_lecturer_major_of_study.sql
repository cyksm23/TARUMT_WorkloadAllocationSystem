-- Existing majors remain unknown until a Programme Leader enters them.
-- Do not copy specialization/interest into a degree-major field.
BEGIN;
ALTER TABLE public.lecturers
    ADD COLUMN IF NOT EXISTS major_of_study VARCHAR(200) NULL;
COMMIT;
