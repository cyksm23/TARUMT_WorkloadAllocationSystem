-- ============================================================
-- Seeds -> 01_reference_data.sql
-- TARUMT Sabah branch — REAL DCIT staff roster (source: SB Teaching
-- Workload 202401.xlsx / user-provided snapshot, Oct 2026)
--
-- Staff IDs are the plain 4-digit TARUMT staff numbers
-- (e.g. '1001'); the 4-digit login code = staff_id.
-- All accounts: password 'password123' (bcrypt via pgcrypto).
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- Departments ------------------------------------------------
INSERT INTO departments (department_code, department_name, description) VALUES
 ('DCIT','Department of Computing and Information Technology','Computing & IT programmes (DSF, DFT, RSD)'),
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
-- Exactly 3 static TARUMT semesters (the course catalogue's universe):
--   S1 = 14 weeks (active) · S2 = 7 weeks · S3 = 14 weeks.
INSERT INTO semesters (academic_year_id, semester_name, semester_code, start_date, end_date, week_count, is_active) VALUES
 ((SELECT id FROM academic_years WHERE year_code='2025/2026'),'Semester 1','S1','2025-06-23','2025-10-26',14,TRUE),
 ((SELECT id FROM academic_years WHERE year_code='2025/2026'),'Semester 2','S2','2025-12-01','2026-01-18',7,FALSE),
 ((SELECT id FROM academic_years WHERE year_code='2025/2026'),'Semester 3','S3','2026-04-26','2026-08-02',14,FALSE);

-- ============================================================
-- USERS  (id 1..19 = lecturers, id 20 = admin)
-- role: 'coordinator' = Programme Leader (is_PL), else 'lecturer'
-- ============================================================
INSERT INTO users (username, password_hash, email, role) VALUES
 ('surayaini',    crypt('password123', gen_salt('bf',10)),'surayaini@tarc.edu.my',      'coordinator'),   --  1
 ('nurrahmat',    crypt('password123', gen_salt('bf',10)),'mohdnurrahmat@tarc.edu.my',  'coordinator'),   --  2
 ('christopher',  crypt('password123', gen_salt('bf',10)),'christopherl@tarc.edu.my',   'lecturer'),      --  3
 ('chew.th',      crypt('password123', gen_salt('bf',10)),'chewth@tarc.edu.my',         'lecturer'),      --  4
 ('leeyeefong',   crypt('password123', gen_salt('bf',10)),'leeyeefong@tarc.edu.my',     'lecturer'),      --  5
 ('tengns',       crypt('password123', gen_salt('bf',10)),'tengns@tarc.edu.my',         'lecturer'),      --  6
 ('patriciagk',   crypt('password123', gen_salt('bf',10)),'patriciagk@tarc.edu.my',     'lecturer'),      --  7
 ('ellis.chieng', crypt('password123', gen_salt('bf',10)),'chienge@tarc.edu.my',        'lecturer'),      --  8
 ('norshikin',    crypt('password123', gen_salt('bf',10)),'norshikin@tarc.edu.my',      'lecturer'),      --  9
 ('jefther',      crypt('password123', gen_salt('bf',10)),'jeftheredward@tarc.edu.my',  'lecturer'),      -- 10
 ('daniel.royd',  crypt('password123', gen_salt('bf',10)),'danielroyd@tarc.edu.my',     'lecturer'),      -- 11
 ('limjz',        crypt('password123', gen_salt('bf',10)),'limjz@tarc.edu.my',          'lecturer'),      -- 12
 ('juramizan',    crypt('password123', gen_salt('bf',10)),'p3984@tarc.edu.my',          'lecturer'),      -- 13
 ('andy.liew',    crypt('password123', gen_salt('bf',10)),'p4038@tarc.edu.my',          'lecturer'),      -- 14
 ('paul.peter',   crypt('password123', gen_salt('bf',10)),'p3985@tarc.edu.my',          'lecturer'),      -- 15
 ('harry.chung',  crypt('password123', gen_salt('bf',10)),'p4018@tarc.edu.my',          'lecturer'),      -- 16
 ('paula',        crypt('password123', gen_salt('bf',10)),'p3950@tarc.edu.my',          'lecturer'),      -- 17
 ('natasha',      crypt('password123', gen_salt('bf',10)),'p3939@tarc.edu.my',          'lecturer'),      -- 18
 ('afendy',       crypt('password123', gen_salt('bf',10)),'p3970@tarc.edu.my',          'lecturer'),      -- 19
 ('admin',        crypt('password123', gen_salt('bf',10)),'admin@tarc.edu.my',          'admin');         -- 20

-- ============================================================
-- LECTURERS — full-time (staff_id 1001..1012)
-- ============================================================
INSERT INTO lecturers (staff_id, user_id, department_id, full_name, email, position, is_pl, qualifications, specialization, area_of_interest, employment_type, max_workload_hours) VALUES
 ('1001',(SELECT id FROM users WHERE username='surayaini'),    (SELECT id FROM departments WHERE department_code='DCIT'),'Pn. Surayaini Binti Basri','surayaini@tarc.edu.my','Programme Leader',   TRUE ,'BCompSc (UMP), MSc (UMS)','Software Engineering','Natural Language Processing','FULL_TIME',12.00),
 ('1002',(SELECT id FROM users WHERE username='nurrahmat'),    (SELECT id FROM departments WHERE department_code='DCIT'),'En. Mohd Nur Rahmat Bin Mohd Taat','mohdnurrahmat@tarc.edu.my','Programme Leader', TRUE,'BCompSc (Hons) (UMS), MSc (Sund.)','Computer Science','Cybersecurity, Networking, Human Computer Interaction','FULL_TIME',12.00),
 ('1003',(SELECT id FROM users WHERE username='christopher'),  (SELECT id FROM departments WHERE department_code='DCIT'),'Dr. Christopher Lazarus','christopherl@tarc.edu.my','Assistant Professor', FALSE,'BSc (Portsm), PhD (Essex)','Evolutionary Computation, Robotics','Artificial Intelligence, Machine Learning','FULL_TIME',16.00),
 ('1004',(SELECT id FROM users WHERE username='chew.th'),      (SELECT id FROM departments WHERE department_code='DCIT'),'Dr. Chew Tze Ha','chewth@tarc.edu.my','Assistant Professor', FALSE,'DipIT, BIT (Hons), MInfTech (OUM), PhD (UMS)','Computer Science, IT','Cloud Computing, Programming','FULL_TIME',16.00),
 ('1005',(SELECT id FROM users WHERE username='leeyeefong'),   (SELECT id FROM departments WHERE department_code='DCIT'),'Pn. Lee Yee Fong','leeyeefong@tarc.edu.my','Senior Lecturer', FALSE,'BIT (Hons) (UMS), MSc (USM)','Information and Communication Technology Management','Multimedia, Human Computer Interaction','FULL_TIME',16.00),
 ('1006',(SELECT id FROM users WHERE username='tengns'),       (SELECT id FROM departments WHERE department_code='DCIT'),'Pn. Teng Nga Sing','tengns@tarc.edu.my','Senior Lecturer', FALSE,'BIT (Hons), MSc (UMS)','Computer Science','Database, Programming, Analysis and Design of IS, MIS','FULL_TIME',16.00),
 ('1007',(SELECT id FROM users WHERE username='patriciagk'),   (SELECT id FROM departments WHERE department_code='DCIT'),'Pn. Patricia G Kissol','patriciagk@tarc.edu.my','Senior Lecturer', FALSE,'BSc (Hons) (Brad), MEd (UMS)','Mathematics and Statistics','Learning Approaches in Education','FULL_TIME',16.00),
 ('1008',(SELECT id FROM users WHERE username='ellis.chieng'), (SELECT id FROM departments WHERE department_code='DCIT'),'Cik Ellis Chieng','chienge@tarc.edu.my','Lecturer', FALSE,'BSc (Hons) (UTM), MInfTech candidate','Computer Science, IT','Cloud Computing, Programming','FULL_TIME',16.00),
 ('1009',(SELECT id FROM users WHERE username='norshikin'),    (SELECT id FROM departments WHERE department_code='DCIT'),'Ts. Norshikin Binti Zainal Abidin','norshikin@tarc.edu.my','Lecturer', FALSE,'BCompSc (Hons), MCompSc (UMS), P.Tech., PhD candidate','HCI, Gamification & Mobile Application','Human Computer Interaction','FULL_TIME',16.00),
 ('1010',(SELECT id FROM users WHERE username='jefther'),      (SELECT id FROM departments WHERE department_code='DCIT'),'En. Jefther Edward','jeftheredward@tarc.edu.my','Lecturer', FALSE,'BCompSc (Hons) (UNIMAS), MEd (UMS)','Web Development and Software Development','Software Design, Software Architecture, ICT in Education and Architecture','FULL_TIME',16.00),
 ('1011',(SELECT id FROM users WHERE username='daniel.royd'),  (SELECT id FROM departments WHERE department_code='DCIT'),'En. Daniel Royd Michael','danielroyd@tarc.edu.my','Lecturer', FALSE,'BSc (Hons) (KLMUC), MInfComnTechMgt (AeU), CCNA certified','Computer Networking','Network PenTesting, RF Manipulation','FULL_TIME',16.00),
 ('1012',(SELECT id FROM users WHERE username='limjz'),        (SELECT id FROM departments WHERE department_code='DCIT'),'En. Lim Jia Zheng','limjz@tarc.edu.my','Lecturer', FALSE,'BCompSc (Hons), MSc (UMS), PhD candidate','Computer Science','Machine Learning, Affective Computing','FULL_TIME',16.00);

-- ============================================================
-- LECTURERS — part-time (staff_id 3950, 3939, 3970, 3984, 3985, 4018, 4038)
-- ============================================================
INSERT INTO lecturers (staff_id, user_id, department_id, full_name, email, position, is_pl, qualifications, specialization, area_of_interest, employment_type, max_workload_hours) VALUES
 ('3984',(SELECT id FROM users WHERE username='juramizan'),   (SELECT id FROM departments WHERE department_code='DCIT'),'JurAmizan','p3984@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00),
 ('4038',(SELECT id FROM users WHERE username='andy.liew'),   (SELECT id FROM departments WHERE department_code='DCIT'),'Andy Liew Pik Hern','p4038@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00),
 ('3985',(SELECT id FROM users WHERE username='paul.peter'),  (SELECT id FROM departments WHERE department_code='DCIT'),'Paul Peter','p3985@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00),
 ('4018',(SELECT id FROM users WHERE username='harry.chung'), (SELECT id FROM departments WHERE department_code='DCIT'),'Harry Chung','p4018@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00),
 ('3950',(SELECT id FROM users WHERE username='paula'),       (SELECT id FROM departments WHERE department_code='DCIT'),'Paula','p3950@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00),
 ('3939',(SELECT id FROM users WHERE username='natasha'),     (SELECT id FROM departments WHERE department_code='DCIT'),'Natasha','p3939@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00),
 ('3970',(SELECT id FROM users WHERE username='afendy'),      (SELECT id FROM departments WHERE department_code='DCIT'),'Afendy','p3970@tarc.edu.my','Lecturer', FALSE, NULL, NULL, NULL,'PART_TIME',8.00);

-- ============================================================
-- SUBJECTS (sample from the teaching workload sheet)
-- ============================================================
INSERT INTO subjects (subject_code, subject_name, programme_id, semester_id, credit_hours, lecture_hours, tutorial_hours, practical_hours, total_hours, student_count, group_count) VALUES
 ('AACS2204','Object-Oriented Programming Techniques',  (SELECT id FROM programmes WHERE programme_code='DSF'),(SELECT id FROM semesters WHERE semester_code='S1'),4.0,2.0,1.0,2.0,5.0,120,6),
 ('AACS3013','Database Development and Applications',   (SELECT id FROM programmes WHERE programme_code='DSF'),(SELECT id FROM semesters WHERE semester_code='S1'),3.0,2.0,1.0,1.0,4.0,80 ,4),
 ('AACS2034','Fundamentals of Computer Networks',       (SELECT id FROM programmes WHERE programme_code='DFT'),(SELECT id FROM semesters WHERE semester_code='S2'),4.0,2.0,1.0,2.0,5.0,90 ,5),
 ('AAMS3184','Discrete Mathematics',                    (SELECT id FROM programmes WHERE programme_code='DFT'),(SELECT id FROM semesters WHERE semester_code='S2'),4.0,3.0,1.5,0.0,4.5,60 ,4),
 ('AMIT2043','Web Systems and Technologies',            (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S2'),3.0,2.0,0.0,2.0,4.0,45 ,3),
 ('BACS1053','Database Management',                     (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S1'),3.0,2.0,1.0,1.0,4.0,40 ,2),
 ('BAIT2073','Mobile Application Development',          (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S1'),3.0,2.0,0.0,2.0,4.0,35 ,2),
 ('BMIT3084','Enterprise Networking',                   (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S2'),4.0,2.0,1.0,2.0,5.0,30 ,2),
 ('AACS1013','Information Technology',                  (SELECT id FROM programmes WHERE programme_code='DFT'),(SELECT id FROM semesters WHERE semester_code='S1'),3.0,2.0,0.0,1.0,3.0,150,8),
 ('BACS3063','Software Engineering Practices',          (SELECT id FROM programmes WHERE programme_code='RSD'),(SELECT id FROM semesters WHERE semester_code='S2'),3.0,2.0,1.0,1.0,4.0,50 ,3);

-- Class-size rules --------------------------------------------
-- Flexible tutorial / practical class limits (editable by the PL).
-- A class exceeding the limit splits into groups.
INSERT INTO class_size_rules (class_type, limit_students) VALUES
 ('TUTORIAL',36),
 ('PRACTICAL',28)
ON CONFLICT (class_type) DO NOTHING;

COMMIT;
