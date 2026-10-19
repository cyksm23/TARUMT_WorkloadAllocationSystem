-- ============================================================
-- Seeds -> 01_reference_data.sql
-- TARUMT Sabah branch sample data (reference data only)
-- Password for ALL seeded accounts: password123
--   (bcrypt, generated via pgcrypto -> gen_salt('bf',10))
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- Departments ------------------------------------------------
INSERT INTO departments (department_code, department_name, description) VALUES
 ('DCIT','Department of Computing and Information Technology','Computing & IT programmes (DSF, DFT, RSD, AICS)'),
 ('DACB','Department of Accounting and Business','Accounting & business programmes'),
 ('DSSH','Department of Social Science and Hospitality','Social science & hospitality programmes');

-- Programmes ------------------------------------------------
INSERT INTO programmes (programme_code, programme_name, department_id, level, duration_years) VALUES
 ('DSF','Diploma in Software Engineering',        (SELECT id FROM departments WHERE department_code='DCIT'),'Diploma',3),
 ('DFT','Diploma in Information Technology',      (SELECT id FROM departments WHERE department_code='DCIT'),'Diploma',3),
 ('RSD','Bachelor of Information Technology (Hons) in Software Systems Development',(SELECT id FROM departments WHERE department_code='DCIT'),'Bachelor',3),
 ('DAC','Diploma in Accounting',                  (SELECT id FROM departments WHERE department_code='DACB'),'Diploma',3),
 ('DBU','Bachelor of Business (Hons)',            (SELECT id FROM departments WHERE department_code='DACB'),'Bachelor',3),
 ('DMK','Diploma in Marketing',                   (SELECT id FROM departments WHERE department_code='DACB'),'Diploma',3);

-- Academic years --------------------------------------------
INSERT INTO academic_years (year_code, start_date, end_date, is_active) VALUES
 ('2024/2025','2024-06-24','2025-04-20', FALSE),
 ('2025/2026','2025-06-23','2026-04-19', TRUE);

-- Semesters -------------------------------------------------
INSERT INTO semesters (academic_year_id, semester_name, semester_code, start_date, end_date, week_count, is_active) VALUES
 ((SELECT id FROM academic_years WHERE year_code='2024/2025'),'Semester 1','S1','2024-06-24','2024-10-27',14,FALSE),
 ((SELECT id FROM academic_years WHERE year_code='2024/2025'),'Semester 2','S2','2024-12-02','2025-04-20',14,FALSE),
 ((SELECT id FROM academic_years WHERE year_code='2025/2026'),'Semester 1','S1','2025-06-23','2025-10-26',14,TRUE),
 ((SELECT id FROM academic_years WHERE year_code='2025/2026'),'Semester 2','S2','2025-12-01','2026-04-19',14,FALSE);

-- Users  (role seed; all bcrypt password123) -----------------
-- admin user
INSERT INTO users (username, password_hash, email, role) VALUES
 ('admin', crypt('password123', gen_salt('bf',10)),'admin@tarc.edu.my','admin');

-- 15 full-time lecturers (user row + lecturer row)
INSERT INTO users (username, password_hash, email, role) VALUES
 ('ellis.chieng',     crypt('password123', gen_salt('bf',10)),'ellis.chieng@tarc.edu.my',     'lecturer'),
 ('chris.lazarus',    crypt('password123', gen_salt('bf',10)),'christopher.lazarus@tarc.edu.my','lecturer'),
 ('teng.ngasing',     crypt('password123', gen_salt('bf',10)),'teng.ngasing@tarc.edu.my',     'lecturer'),
 ('lee.yeefong',      crypt('password123', gen_salt('bf',10)),'lee.yeefong@tarc.edu.my',      'lecturer'),
 ('patricia.kissol',  crypt('password123', gen_salt('bf',10)),'patricia.kissol@tarc.edu.my',  'lecturer'),
 ('surayaini.basri',  crypt('password123', gen_salt('bf',10)),'surayaini.basri@tarc.edu.my',  'lecturer'),
 ('norshikin.zainal', crypt('password123', gen_salt('bf',10)),'norshikin.zainal@tarc.edu.my', 'lecturer'),
 ('jefther.edwards',  crypt('password123', gen_salt('bf',10)),'jefther.edwards@tarc.edu.my',  'lecturer'),
 ('daniel.royd',      crypt('password123', gen_salt('bf',10)),'daniel.royd@tarc.edu.my',      'lecturer'),
 ('lim.jiazheng',     crypt('password123', gen_salt('bf',10)),'lim.jiazheng@tarc.edu.my',     'lecturer'),
 ('nur.rahmat',       crypt('password123', gen_salt('bf',10)),'nurrahmat.taat@tarc.edu.my',   'lecturer'),
 ('muada.ojihi',      crypt('password123', gen_salt('bf',10)),'muada.ojihi@tarc.edu.my',      'lecturer'),
 ('kenny.chung',      crypt('password123', gen_salt('bf',10)),'kenny.chung@tarc.edu.my',      'lecturer'),
 ('joanne.lo',        crypt('password123', gen_salt('bf',10)),'joanne.lo@tarc.edu.my',        'lecturer'),
 ('rita.kwan',        crypt('password123', gen_salt('bf',10)),'rita.kwan@tarc.edu.my',        'lecturer');

-- 7 part-time lecturers
INSERT INTO users (username, password_hash, email, role) VALUES
 ('juramizan', crypt('password123', gen_salt('bf',10)),'juramizan@tarc.edu.my','lecturer'),
 ('andy.liew', crypt('password123', gen_salt('bf',10)),'andy.liew@tarc.edu.my','lecturer'),
 ('paul.peter',crypt('password123', gen_salt('bf',10)),'paul.peter@tarc.edu.my','lecturer'),
 ('harry.chung',crypt('password123', gen_salt('bf',10)),'harry.chung@tarc.edu.my','lecturer'),
 ('paula',     crypt('password123', gen_salt('bf',10)),'paula@tarc.edu.my','lecturer'),
 ('natasha',   crypt('password123', gen_salt('bf',10)),'natasha@tarc.edu.my','lecturer'),
 ('afendy',    crypt('password123', gen_salt('bf',10)),'afendy@tarc.edu.my','lecturer');

-- Lecturers (full-time) --------------------------------------
INSERT INTO lecturers (staff_id, user_id, department_id, full_name, email, position, employment_type, max_workload_hours) VALUES
 ('L1001',(SELECT id FROM users WHERE username='ellis.chieng'),    (SELECT id FROM departments WHERE department_code='DCIT'),'Ellis Chieng','ellis.chieng@tarc.edu.my','Programme Leader','FULL_TIME',12.00),
 ('L1002',(SELECT id FROM users WHERE username='chris.lazarus'),   (SELECT id FROM departments WHERE department_code='DCIT'),'Dr. Christopher Lazarus','christopher.lazarus@tarc.edu.my','Head of Programme','FULL_TIME',12.00),
 ('L1003',(SELECT id FROM users WHERE username='teng.ngasing'),    (SELECT id FROM departments WHERE department_code='DCIT'),'Teng Nga Sing','teng.ngasing@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1004',(SELECT id FROM users WHERE username='lee.yeefong'),     (SELECT id FROM departments WHERE department_code='DCIT'),'Lee Yee Fong','lee.yeefong@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1005',(SELECT id FROM users WHERE username='patricia.kissol'), (SELECT id FROM departments WHERE department_code='DCIT'),'Patricia Kissol','patricia.kissol@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1006',(SELECT id FROM users WHERE username='surayaini.basri'), (SELECT id FROM departments WHERE department_code='DCIT'),'Surayaini Bt Basri','surayaini.basri@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1007',(SELECT id FROM users WHERE username='norshikin.zainal'),(SELECT id FROM departments WHERE department_code='DCIT'),'Norshikin Bt Zainal Abidin','norshikin.zainal@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1008',(SELECT id FROM users WHERE username='jefther.edwards'), (SELECT id FROM departments WHERE department_code='DCIT'),'Jefther Edwards','jefther.edwards@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1009',(SELECT id FROM users WHERE username='daniel.royd'),     (SELECT id FROM departments WHERE department_code='DCIT'),'Daniel Royd','daniel.royd@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1010',(SELECT id FROM users WHERE username='lim.jiazheng'),    (SELECT id FROM departments WHERE department_code='DCIT'),'Lim Jia Zheng','lim.jiazheng@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1011',(SELECT id FROM users WHERE username='nur.rahmat'),      (SELECT id FROM departments WHERE department_code='DCIT'),'Mohd Nur Rahmat bin Mohd Taat','nurrahmat.taat@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1012',(SELECT id FROM users WHERE username='muada.ojihi'),     (SELECT id FROM departments WHERE department_code='DCIT'),'Muada Bin Ojihi','muada.ojihi@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1013',(SELECT id FROM users WHERE username='kenny.chung'),     (SELECT id FROM departments WHERE department_code='DCIT'),'Kenny Chung Kuan Tsin','kenny.chung@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1014',(SELECT id FROM users WHERE username='joanne.lo'),       (SELECT id FROM departments WHERE department_code='DCIT'),'Joanne Lo','joanne.lo@tarc.edu.my','Lecturer','FULL_TIME',16.00),
 ('L1015',(SELECT id FROM users WHERE username='rita.kwan'),       (SELECT id FROM departments WHERE department_code='DCIT'),'Kwan Lee Kun Rita','rita.kwan@tarc.edu.my','Lecturer','FULL_TIME',16.00);

-- Lecturers (part-time) --------------------------------------
INSERT INTO lecturers (staff_id, user_id, department_id, full_name, email, position, employment_type, max_workload_hours) VALUES
 ('L2001',(SELECT id FROM users WHERE username='juramizan'), (SELECT id FROM departments WHERE department_code='DCIT'),'JurAmizan','juramizan@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00),
 ('L2002',(SELECT id FROM users WHERE username='andy.liew'), (SELECT id FROM departments WHERE department_code='DCIT'),'Andy Liew Pik Hern','andy.liew@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00),
 ('L2003',(SELECT id FROM users WHERE username='paul.peter'),(SELECT id FROM departments WHERE department_code='DACB'),'Paul Peter','paul.peter@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00),
 ('L2004',(SELECT id FROM users WHERE username='harry.chung'),(SELECT id FROM departments WHERE department_code='DACB'),'Harry Chung','harry.chung@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00),
 ('L2005',(SELECT id FROM users WHERE username='paula'),     (SELECT id FROM departments WHERE department_code='DSSH'),'Paula','paula@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00),
 ('L2006',(SELECT id FROM users WHERE username='natasha'),   (SELECT id FROM departments WHERE department_code='DSSH'),'Natasha','natasha@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00),
 ('L2007',(SELECT id FROM users WHERE username='afendy'),    (SELECT id FROM departments WHERE department_code='DSSH'),'Afendy','afendy@tarc.edu.my','Part-time Lecturer','PART_TIME',12.00);

-- Subjects (DCIT sample; first 2 also used across semesters) --
INSERT INTO subjects (subject_code, subject_name, programme_id, semester_id, credit_hours, lecture_hours, tutorial_hours, practical_hours, total_hours, student_count, group_count) VALUES
 ('AACS2204','Object-Oriented Programming Techniques',  (SELECT id FROM programmes WHERE programme_code='DSF'),(SELECT id FROM semesters WHERE semester_code='S1' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2025/2026')),4.0,2.0,1.0,2.0,5.0,120,6),
 ('AACS3013','Database Development and Applications',   (SELECT id FROM programmes WHERE programme_code='DSF'),(SELECT id FROM semesters WHERE semester_code='S1' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2025/2026')),3.0,2.0,1.0,1.0,4.0,80 ,4),
 ('AACS2034','Fundamentals of Computer Networks',       (SELECT id FROM programmes WHERE programme_code='DFT'),(SELECT id FROM semesters WHERE semester_code='S2' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2024/2025')),4.0,2.0,1.0,2.0,5.0,90 ,5),
 ('AAMS3184','Discrete Mathematics',                    (SELECT id FROM programmes WHERE programme_code='DFT'),(SELECT id FROM semesters WHERE semester_code='S2' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2024/2025')),4.0,3.0,1.5,0.0,4.5,60 ,4),
 ('AMIT2043','Web Systems and Technologies',            (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S2' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2024/2025')),3.0,2.0,0.0,2.0,4.0,45 ,3),
 ('BACS1053','Database Management',                     (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S1' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2025/2026')),3.0,2.0,1.0,1.0,4.0,40 ,2),
 ('BAIT2073','Mobile Application Development',          (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S1' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2025/2026')),3.0,2.0,0.0,2.0,4.0,35 ,2),
 ('BMIT3084','Enterprise Networking',                   (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S2' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2024/2025')),4.0,2.0,1.0,2.0,5.0,30 ,2),
 ('AACS1013','Information Technology',                  (SELECT id FROM programmes WHERE programme_code='DFT'),(SELECT id FROM semesters WHERE semester_code='S1' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2025/2026')),3.0,2.0,0.0,1.0,3.0,150,8),
 ('BACS3063','Software Engineering Practices',          (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S2' AND academic_year_id=(SELECT id FROM academic_years WHERE year_code='2024/2025')),3.0,2.0,1.0,1.0,4.0,50 ,3);

COMMIT;
