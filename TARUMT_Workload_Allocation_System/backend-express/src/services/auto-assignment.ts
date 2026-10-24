/** Deterministic, explainable suggestions; no external AI or inferred profiles.
 * Criteria are compared in the user's chosen order, not mixed percentages.
 * Specializations are read only from the lecturer profile, never guessed.
 * Weekly hours follow the existing whole-course assignment model: L + T + P.
 */

import { DEFAULT_ASSIGNMENT_PRIORITIES, isAssignmentPriorityOrder, type AssignmentPriority } from "./auto-assignment-options";

export const ASSIGNMENT_LEVEL_CAPS: Record<string, number> = { Bachelor: 3, Diploma: 4 };
export const TEACHING_ACTIVITIES = ["LECTURE", "TUTORIAL", "PRACTICAL"] as const;

export interface AutoCourse {
  id: number;
  subjectCode: string;
  subjectName: string;
  programmeCode: string | null;
  programmeName: string;
  level: string | null;
  academicYearId: number;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  tutorialStudents: number | null;
  practicalStudents: number | null;
  studentCount: number | null;
  isActive: boolean;
}

export interface AutoLecturer {
  id: number;
  staffId: string;
  fullName: string;
  areaOfInterest: string | null;
  specialization: string | null;
  minHours: number;
  maxHours: number;
  isActive: boolean;
}

export interface ExistingTeaching {
  lecturerId: number;
  academicYearId: number;
  subjectId: number;
  level: string | null;
  activityType: string;
  groupName: string | null;
  hoursPerWeek: number;
}

export interface HistoricalTeaching {
  lecturerId: number;
  academicYearId: number;
  academicYearLabel: string;
  subjectId: number;
  subjectCode: string;
  subjectName: string;
  endDate: string;
}

export interface TeachingHistoryMatch {
  subjectCode: string;
  subjectName: string;
  academicYearLabel: string;
  matchType: "same_course" | "related_topic" | "keyword";
}

export interface AutoAssignmentSnapshot {
  term: { id: number; label: string; weekCount: number; startDate: string };
  asOfDate: string;
  programmeCode: string | null;
  priorities: AssignmentPriority[];
  courses: AutoCourse[];
  lecturers: AutoLecturer[];
  allocations: ExistingTeaching[];
  teachingHistory: HistoricalTeaching[];
  protectedLecturerIds: number[];
}

export interface AutoAssignmentProposal {
  subjectCode: string;
  subjectName: string;
  programmeCode: string | null;
  lecturerId: number;
  staffId: string;
  lecturerName: string;
  areaOfInterest: string | null;
  specialization: string | null;
  interestMatches: string[];
  specializationMatches: string[];
  historyMatches: TeachingHistoryMatch[];
  weeklyHours: number;
  beforeHours: number;
  afterHours: number;
  minHours: number;
  maxHours: number;
}

export interface UnassignedCourse {
  subjectCode: string;
  subjectName: string;
  reason: string;
}

export interface AutoAssignmentPlan {
  academicYearId: number;
  academicYearLabel: string;
  programmeCode: string | null;
  priorities: AssignmentPriority[];
  historyRecordCount: number;
  previewToken: string;
  proposals: AutoAssignmentProposal[];
  unassigned: UnassignedCourse[];
  existingCount: number;
  inactiveCount: number;
}

const TOPICS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Programming", pattern: /\b(programming|coding|algorithms?|object oriented|software development)\b/ },
  { label: "Software engineering", pattern: /\b(software engineering|software design|software architecture|systems analysis|analysis and design)\b/ },
  { label: "Web development", pattern: /\b(web|website|websites|front end|back end)\b/ },
  { label: "Databases", pattern: /\b(databases?|sql|data management)\b/ },
  { label: "Networking", pattern: /\b(networks?|networking|ccna|rf manipulation)\b/ },
  { label: "Cybersecurity", pattern: /\b(cybersecurity|cyber security|security|pentesting|pen testing)\b/ },
  { label: "Mobile applications", pattern: /\b(mobile|android|ios|gamification)\b/ },
  { label: "Human computer interaction", pattern: /\b(hci|human computer interaction|usability|user experience)\b/ },
  { label: "Artificial intelligence", pattern: /\b(ai|artificial intelligence|machine learning|deep learning|affective computing|natural language processing|nlp|evolutionary computation|robotics)\b/ },
  { label: "Cloud computing", pattern: /\b(cloud|distributed computing)\b/ },
  { label: "Mathematics / statistics", pattern: /\b(mathematics|mathematical|maths?|statistics|statistical|calculus|algebra|discrete)\b/ },
  { label: "Multimedia", pattern: /\b(multimedia|graphics|animation)\b/ },
  { label: "Information technology", pattern: /\b(information technology|information and communication technology|ict|it|bit|minftech)\b/ },
];

const GENERAL_COMPUTING = /\b(computer science|computing|bcompsc|mcompsc|information technology|information and communication technology|bit|minftech|software engineering|software development)\b/;
const STOP_WORDS = new Set((
  "the and for with from into introduction introductory fundamentals fundamental advanced " +
  "principles techniques practices application applications system systems technology technologies " +
  "information computer science bachelor diploma master hons honours degree development management engineering"
).split(" "));

const normalized = (text: string | null) => (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keywords = (text: string) => Array.from(new Set(
  text.split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
));
const topics = (text: string) => TOPICS.filter((topic) => topic.pattern.test(text)).map((topic) => topic.label);
const unique = (values: string[]) => Array.from(new Set(values));
export const roundHours = (hours: number) => Math.round(hours * 100) / 100;

/** Only the explicitly recorded specialization contributes to this score. */
export function matchLecturerProfile(course: AutoCourse, lecturer: AutoLecturer) {
  const title = normalized(course.subjectName);
  const interest = normalized(lecturer.areaOfInterest);
  const specialization = normalized(lecturer.specialization);
  const courseTopics = topics(title);
  const courseWords = keywords(title);
  const interestTopics = topics(interest);
  const specializationTopics = topics(specialization);
  const interestWords = new Set(keywords(interest));
  const specializationWords = new Set(keywords(specialization));
  // Known topics take precedence over ambiguous shared words (e.g. learning
  // approaches in education must not match a machine-learning course).
  const interestMatches = unique(courseTopics.length > 0
    ? courseTopics.filter((topic) => interestTopics.includes(topic))
    : courseWords.filter((word) => interestWords.has(word)));
  const specializationMatches = unique(courseTopics.length > 0
    ? courseTopics.filter((topic) => specializationTopics.includes(topic))
    : courseWords.filter((word) => specializationWords.has(word)));
  const denominator = Math.max(1, courseTopics.length || courseWords.length);
  const interestStrength = Math.min(1, interestMatches.length / denominator);
  let specializationStrength = Math.min(1, specializationMatches.length / denominator);

  // A broad computing specialization is a weaker fallback, never a mathematics match.
  const computingCourse = !courseTopics.includes("Mathematics / statistics") &&
    (courseTopics.length > 0 || GENERAL_COMPUTING.test(title));
  if (specializationMatches.length === 0 && computingCourse && GENERAL_COMPUTING.test(specialization)) {
    specializationMatches.push("Broad computing specialization");
    specializationStrength = 0.2;
  }
  return {
    interestMatches,
    specializationMatches,
    relevant: interestMatches.length > 0 || specializationMatches.length > 0,
    interestStrength,
    specializationStrength,
  };
}

/** One historical course/term is one piece of evidence, not three L/T/P hits. */
export function matchTeachingHistory(course: AutoCourse, lecturerId: number, history: HistoricalTeaching[]) {
  const title = normalized(course.subjectName);
  const courseTopics = topics(title);
  const courseWords = keywords(title);
  const seen = new Set<string>();
  const evidence = history.filter((record) => record.lecturerId === lecturerId).flatMap((record) => {
    const key = `${record.academicYearId}|${record.subjectId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const previousTitle = normalized(record.subjectName);
    const sameCourse = record.subjectCode.toLowerCase() === course.subjectCode.toLowerCase() || previousTitle === title;
    const previousTopics = topics(previousTitle);
    const topicMatches = courseTopics.filter((topic) => previousTopics.includes(topic));
    const previousWords = new Set(keywords(previousTitle));
    const wordMatches = courseTopics.length === 0 ? courseWords.filter((word) => previousWords.has(word)) : [];
    const strength = sameCourse ? 1 : topicMatches.length > 0 ? 0.65 * topicMatches.length / Math.max(1, courseTopics.length)
      : wordMatches.length > 0 ? 0.4 * wordMatches.length / Math.max(1, courseWords.length) : 0;
    if (strength === 0) return [];
    const matchType: TeachingHistoryMatch["matchType"] = sameCourse ? "same_course" : topicMatches.length > 0 ? "related_topic" : "keyword";
    return [{ record, strength, matchType }];
  }).sort((a, b) => b.strength - a.strength || b.record.endDate.localeCompare(a.record.endDate) ||
    a.record.subjectCode.localeCompare(b.record.subjectCode));
  return {
    strength: evidence[0]?.strength ?? 0,
    count: evidence.length,
    matches: evidence.slice(0, 3).map(({ record, matchType }): TeachingHistoryMatch => ({
      subjectCode: record.subjectCode,
      subjectName: record.subjectName,
      academicYearLabel: record.academicYearLabel,
      matchType,
    })),
  };
}

/** Greedy constrained-first planning. Existing work is counted, never rewritten.
 * Course caps intentionally retain the manual API's across-all-years scope;
 * weekly-hour capacity is calculated only within the selected coded term.
 */
export function buildAutoAssignmentPlan(snapshot: AutoAssignmentSnapshot): AutoAssignmentPlan {
  const { term, lecturers, allocations } = snapshot;
  const priorities = snapshot.priorities ?? DEFAULT_ASSIGNMENT_PRIORITIES;
  if (!isAssignmentPriorityOrder(priorities)) throw new Error("Invalid matching priority order.");
  const seenHistory = new Set<string>();
  const teachingHistory = snapshot.teachingHistory.filter((record) => {
    const key = `${record.lecturerId}|${record.academicYearId}|${record.subjectId}`;
    if (record.academicYearId === term.id || record.endDate >= term.startDate || record.endDate >= snapshot.asOfDate || seenHistory.has(key)) return false;
    seenHistory.add(key);
    return true;
  });
  const hours = new Map<number, number>();
  const courseSets = new Map<string, Set<number>>();
  const assigned = new Set<number>();
  const protectedIds = new Set(snapshot.protectedLecturerIds);
  allocations.forEach((allocation) => {
    if (allocation.academicYearId === term.id) {
      hours.set(allocation.lecturerId, roundHours((hours.get(allocation.lecturerId) ?? 0) + allocation.hoursPerWeek));
    }
    if (!(TEACHING_ACTIVITIES as readonly string[]).includes(allocation.activityType)) return;
    assigned.add(allocation.subjectId);
    if (allocation.groupName !== null) return;
    const key = `${allocation.lecturerId}|${allocation.level ?? ""}`;
    const held = courseSets.get(key) ?? new Set<number>();
    held.add(allocation.subjectId);
    courseSets.set(key, held);
  });

  const scope = snapshot.courses.filter((course) => course.academicYearId === term.id &&
    (!snapshot.programmeCode || course.programmeCode === snapshot.programmeCode));
  const proposals: AutoAssignmentProposal[] = [];
  const unassigned: UnassignedCourse[] = [];
  const available = lecturers.filter((lecturer) => lecturer.isActive);
  const profiles = new Map<string, ReturnType<typeof matchLecturerProfile>>();
  const pastMatches = new Map<string, ReturnType<typeof matchTeachingHistory>>();
  const profileFor = (course: AutoCourse, lecturer: AutoLecturer) => {
    const key = `${course.id}|${lecturer.id}`;
    let profile = profiles.get(key);
    if (!profile) {
      profile = matchLecturerProfile(course, lecturer);
      profiles.set(key, profile);
    }
    return profile;
  };
  const historyFor = (course: AutoCourse, lecturer: AutoLecturer) => {
    const key = `${course.id}|${lecturer.id}`;
    let match = pastMatches.get(key);
    if (!match) {
      match = matchTeachingHistory(course, lecturer.id, teachingHistory);
      pastMatches.set(key, match);
    }
    return match;
  };
  const relevant = (course: AutoCourse, lecturer: AutoLecturer) =>
    profileFor(course, lecturer).relevant || historyFor(course, lecturer).strength > 0;
  const weeklyHours = (course: AutoCourse) => roundHours(course.lectureHours + course.tutorialHours + course.practicalHours);
  const withinCapacity = (course: AutoCourse, lecturer: AutoLecturer) => {
    const components = [course.lectureHours, course.tutorialHours, course.practicalHours];
    if (components.some((value) => !Number.isFinite(value) || value < 0) || weeklyHours(course) <= 0) return false;
    const projected = roundHours((hours.get(lecturer.id) ?? 0) + weeklyHours(course));
    const held = courseSets.get(`${lecturer.id}|${course.level ?? ""}`)?.size ?? 0;
    const cap = ASSIGNMENT_LEVEL_CAPS[course.level ?? ""];
    return !protectedIds.has(lecturer.id) && Number.isFinite(lecturer.minHours) && lecturer.minHours >= 0 &&
      Number.isFinite(lecturer.maxHours) && lecturer.maxHours > 0 && lecturer.minHours <= lecturer.maxHours &&
      projected <= lecturer.maxHours && (!cap || held + 1 <= cap);
  };

  const pending = scope.filter((course) => course.isActive && !assigned.has(course.id));
  const initialCandidates = (course: AutoCourse) => available.filter((lecturer) =>
    relevant(course, lecturer) && withinCapacity(course, lecturer)).length;
  pending.sort((a, b) => initialCandidates(a) - initialCandidates(b) ||
    weeklyHours(b) - weeklyHours(a) || a.subjectCode.localeCompare(b.subjectCode));

  for (const course of pending) {
    const matching = available.filter((lecturer) => relevant(course, lecturer));
    const candidates = matching.filter((lecturer) => withinCapacity(course, lecturer)).map((lecturer) => {
      const beforeHours = hours.get(lecturer.id) ?? 0;
      const afterHours = roundHours(beforeHours + weeklyHours(course));
      const profile = profileFor(course, lecturer);
      const history = historyFor(course, lecturer);
      return { lecturer, profile, history, beforeHours, afterHours };
    }).sort((a, b) => {
      for (const priority of priorities) {
        let difference = 0;
        if (priority === "workload") {
          const aBelowTarget = a.beforeHours < a.lecturer.minHours;
          const bBelowTarget = b.beforeHours < b.lecturer.minHours;
          if (aBelowTarget !== bBelowTarget) return aBelowTarget ? -1 : 1;
          difference = a.afterHours / a.lecturer.maxHours - b.afterHours / b.lecturer.maxHours;
        } else if (priority === "specialization") difference = b.profile.specializationStrength - a.profile.specializationStrength;
        else if (priority === "interest") difference = b.profile.interestStrength - a.profile.interestStrength;
        else difference = b.history.strength - a.history.strength || b.history.count - a.history.count;
        if (Math.abs(difference) > 0.000001) return difference;
      }
      return a.lecturer.staffId.localeCompare(b.lecturer.staffId);
    });

    const best = candidates[0];
    if (!best) {
      unassigned.push({
        subjectCode: course.subjectCode,
        subjectName: course.subjectName,
        reason: weeklyHours(course) <= 0 || !Number.isFinite(weeklyHours(course))
          ? "Enter valid teaching hours for this course first."
          : matching.length === 0
            ? "No active lecturer has a matching recorded specialization, interest or earlier completed-term course assignment. Update the lecturer profile or assign manually."
            : "Matching lecturers have reached an hour/course limit, have invalid limits, or have a pending/approved workload.",
      });
      continue;
    }
    const { lecturer, profile, history, beforeHours, afterHours } = best;
    proposals.push({
      subjectCode: course.subjectCode,
      subjectName: course.subjectName,
      programmeCode: course.programmeCode,
      lecturerId: lecturer.id,
      staffId: lecturer.staffId,
      lecturerName: lecturer.fullName,
      areaOfInterest: lecturer.areaOfInterest,
      specialization: lecturer.specialization,
      interestMatches: profile.interestMatches,
      specializationMatches: profile.specializationMatches,
      historyMatches: history.matches,
      weeklyHours: weeklyHours(course),
      beforeHours,
      afterHours,
      minHours: lecturer.minHours,
      maxHours: lecturer.maxHours,
    });
    hours.set(lecturer.id, afterHours);
    const key = `${lecturer.id}|${course.level ?? ""}`;
    const held = courseSets.get(key) ?? new Set<number>();
    held.add(course.id);
    courseSets.set(key, held);
  }

  return {
    academicYearId: term.id,
    academicYearLabel: term.label,
    programmeCode: snapshot.programmeCode,
    priorities: [...priorities],
    historyRecordCount: teachingHistory.length,
    previewToken: "",
    proposals,
    unassigned,
    existingCount: scope.filter((course) => course.isActive && assigned.has(course.id)).length,
    inactiveCount: scope.filter((course) => !course.isActive).length,
  };
}
