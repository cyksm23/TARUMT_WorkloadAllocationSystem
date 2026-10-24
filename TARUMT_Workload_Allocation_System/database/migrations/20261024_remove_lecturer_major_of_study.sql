-- Consolidate lecturer expertise onto specialization. Preserve a legacy major
-- only when the canonical specialization field is blank, then remove the
-- redundant column. Dynamic SQL keeps this migration safe to run repeatedly.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'lecturers'
           AND column_name = 'major_of_study'
    ) THEN
        EXECUTE $migration$
            UPDATE lecturers
               SET specialization = NULLIF(BTRIM(major_of_study), ''),
                   updated_at = NOW()
             WHERE NULLIF(BTRIM(specialization), '') IS NULL
               AND NULLIF(BTRIM(major_of_study), '') IS NOT NULL
        $migration$;

        ALTER TABLE lecturers DROP COLUMN major_of_study;
    END IF;
END;
$$;
