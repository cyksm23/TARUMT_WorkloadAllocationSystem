/** Domain types mirroring database/schema.sql (snake_case on purpose). */
export interface AcademicYear {
  id: number;
  year_code: string; // '2024/2025'
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Semester {
  id: number;
  academic_year_id: number;
  semester_name: string; // 'Semester 1'
  semester_code: string; // 'S1' | 'S2'
  start_date: string;
  end_date: string;
  week_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  username: string;
  password_hash: string; // never exposed by API
  email: string | null;
  role: "admin" | "coordinator" | "lecturer" | "hod";
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: number;
  department_code: string; // 'DCIT'
  department_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lecturer {
  id: number;
  staff_id: string; // '1001' (4-digit staff number, plain digits)
  user_id: number | null;
  department_id: number | null;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  position: string | null;
  is_pl: boolean;
  qualifications: string | null;
  specialization: string | null;
  area_of_interest: string | null;
  employment_type: "FULL_TIME" | "PART_TIME" | "CONTRACT";
  is_active: boolean;
  max_workload_hours: number;
  created_at: string;
  updated_at: string;
}

export interface Programme {
  id: number;
  programme_code: string; // 'DSF'
  programme_name: string;
  department_id: number | null;
  level: "Bachelor" | "Master" | "Diploma" | null;
  duration_years: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: number;
  subject_code: string; // 'AACS2204'
  subject_name: string;
  programme_id: number | null;
  semester_id: number | null;
  credit_hours: number;
  lecture_hours: number;
  tutorial_hours: number;
  practical_hours: number;
  total_hours: number;
  student_count: number;
  group_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Workload {
  id: number;
  lecturer_id: number;
  semester_id: number;
  total_allocated_hours: number;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
  approved_by: number | null;
  approved_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkloadDetail {
  id: number;
  workload_id: number;
  subject_id: number;
  activity_type:
    | "LECTURE"
    | "TUTORIAL"
    | "PRACTICAL"
    | "LAB"
    | "PROJECT_SUPERVISION"
    | "THESIS_SUPERVISION"
    | "OTHER";
  group_name: string | null; // 'Group A'
  student_count: number;
  hours_per_week: number;
  total_hours: number;
  notes: string | null; // lab courses: Lab 1, Lab 2, 3rd remarks
  created_at: string;
  updated_at: string;
}

export interface WorkloadHistory {
  id: number;
  workload_id: number;
  changed_by: number | null;
  change_type: "CREATED" | "UPDATED" | "APPROVED" | "REJECTED";
  old_value: unknown; // JSONB
  new_value: unknown; // JSONB
  changed_at: string;
}
