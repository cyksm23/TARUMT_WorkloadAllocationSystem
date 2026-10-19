/**
 * DEV FALLBACK — lecturer directory mirroring database/seeds/01_reference_data.sql.
 *
 * Used by the login route handler ONLY when the PostgreSQL database is not
 * reachable / not initialised (and the app is not in production mode).
 * Passwords in the real DB are bcrypt hashes (password123, via pgcrypto).
 * Here the same password is compared against the constant below.
 *
 * Replace this with real DB rows once `database/schema.sql` + seeds are applied.
 */

export interface DevLecturer {
  code: string; // 4-digit lecturer code (staff_id digits, e.g. '1001' -> 'L1001')
  fullName: string;
  role: "admin" | "coordinator" | "lecturer" | "hod";
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT";
  department: string;
  position: string;
}

export const DEV_PASSWORD = "password123";

export const DEV_DIRECTORY: DevLecturer[] = [
  // Admin (code 0000)
  { code: "0000", fullName: "System Administrator", role: "admin", employmentType: "FULL_TIME", department: "DCIT", position: "Administrator" },
  // Full-time lecturers (real DCIT roster)
  { code: "1001", fullName: "Pn. Surayaini Binti Basri", role: "coordinator", employmentType: "FULL_TIME", department: "DCIT", position: "Programme Leader" },
  { code: "1002", fullName: "En. Mohd Nur Rahmat Bin Mohd Taat", role: "coordinator", employmentType: "FULL_TIME", department: "DCIT", position: "Programme Leader" },
  { code: "1003", fullName: "Dr. Christopher Lazarus", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Assistant Professor" },
  { code: "1004", fullName: "Dr. Chew Tze Ha", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Assistant Professor" },
  { code: "1005", fullName: "Pn. Lee Yee Fong", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Senior Lecturer" },
  { code: "1006", fullName: "Pn. Teng Nga Sing", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Senior Lecturer" },
  { code: "1007", fullName: "Pn. Patricia G Kissol", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Senior Lecturer" },
  { code: "1008", fullName: "Cik Ellis Chieng", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Lecturer" },
  { code: "1009", fullName: "Ts. Norshikin Binti Zainal Abidin", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Lecturer" },
  { code: "1010", fullName: "En. Jefther Edward", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Lecturer" },
  { code: "1011", fullName: "En. Daniel Royd Michael", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Lecturer" },
  { code: "1012", fullName: "En. Lim Jia Zheng", role: "lecturer", employmentType: "FULL_TIME", department: "DCIT", position: "Lecturer" },
  // Part-time lecturers (3950/3939/3970/3984/3985/4018/4038, max 8 h)
  { code: "3984", fullName: "JurAmizan", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
  { code: "4038", fullName: "Andy Liew Pik Hern", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
  { code: "3985", fullName: "Paul Peter", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
  { code: "4018", fullName: "Harry Chung", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
  { code: "3950", fullName: "Paula", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
  { code: "3939", fullName: "Natasha", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
  { code: "3970", fullName: "Afendy", role: "lecturer", employmentType: "PART_TIME", department: "DCIT", position: "Lecturer" },
];

export const fallbackAllowed = (): boolean => process.env.NODE_ENV !== "production";
