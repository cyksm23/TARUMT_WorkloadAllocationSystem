import assert from "node:assert/strict";
import test from "node:test";
import { buildAutoAssignmentPlan, matchLecturerProfile, matchTeachingHistory, type AutoAssignmentSnapshot, type AutoCourse, type AutoLecturer, type ExistingTeaching, type HistoricalTeaching } from "../src/services/auto-assignment";
import { parseAutoAssignmentRequest } from "../src/services/auto-assignment-service";
import { DEFAULT_ASSIGNMENT_PRIORITIES, isAssignmentPriorityOrder } from "../src/services/auto-assignment-options";

const course = (overrides: Partial<AutoCourse> = {}): AutoCourse => ({
  id: 1, subjectCode: "TEST1001", subjectName: "Programming", programmeCode: "RSD", programmeName: "Software Development",
  level: "Bachelor", academicYearId: 1, lectureHours: 2, tutorialHours: 1, practicalHours: 1,
  tutorialStudents: null, practicalStudents: null, studentCount: 0, isActive: true, ...overrides,
});
const lecturer = (overrides: Partial<AutoLecturer> = {}): AutoLecturer => ({
  id: 1, staffId: "1001", fullName: "Lecturer One", areaOfInterest: "Programming", specialization: null,
  minHours: 12, maxHours: 20, isActive: true, ...overrides,
});
const allocation = (overrides: Partial<ExistingTeaching> = {}): ExistingTeaching => ({
  lecturerId: 1, academicYearId: 1, subjectId: 99, level: "Bachelor", activityType: "LECTURE", groupName: null, hoursPerWeek: 2, ...overrides,
});
const historical = (overrides: Partial<HistoricalTeaching> = {}): HistoricalTeaching => ({
  lecturerId: 1, academicYearId: 3, academicYearLabel: "202605 · AY 2026/2027", subjectId: 98,
  subjectCode: "OLD1001", subjectName: "Programming", endDate: "2026-08-02", ...overrides,
});
const snapshot = (overrides: Partial<AutoAssignmentSnapshot> = {}): AutoAssignmentSnapshot => ({
  term: { id: 1, label: "202609 · AY 2026/2027", weekCount: 14, startDate: "2026-09-21" }, asOfDate: "2026-10-24", programmeCode: null,
  priorities: [...DEFAULT_ASSIGNMENT_PRIORITIES], courses: [course()], lecturers: [lecturer()], allocations: [], teachingHistory: [], protectedLecturerIds: [], ...overrides,
});

test("interest and specialization evidence have independent strengths, not mixed percentages", () => {
  const match = matchLecturerProfile(course(), lecturer({ specialization: "Programming" }));
  assert.equal(match.interestStrength, 1);
  assert.equal(match.specializationStrength, 1);
  assert.deepEqual(match.interestMatches, ["Programming"]);
  assert.deepEqual(match.specializationMatches, ["Programming"]);
});

test("a mathematics specialization can qualify without an interest; a computing specialization cannot", () => {
  const maths = course({ subjectName: "Discrete Mathematics" });
  assert.equal(matchLecturerProfile(maths, lecturer({ areaOfInterest: null, specialization: "Mathematics and Statistics" })).specializationStrength, 1);
  assert.equal(matchLecturerProfile(maths, lecturer({ areaOfInterest: null, specialization: "Computer Science" })).relevant, false);
});

test("a missing specialization is not inferred from generic qualifications", () => {
  const staff = { ...lecturer({ areaOfInterest: null }), qualifications: "BSc, MSc, PhD" };
  assert.equal(matchLecturerProfile(course({ subjectName: "Mathematics" }), staff).relevant, false);
});

test("topic aliases match network/networking, HCI and NLP without AI", () => {
  assert.equal(matchLecturerProfile(course({ subjectName: "Computer Networks" }), lecturer({ areaOfInterest: "Networking" })).interestStrength, 1);
  assert.equal(matchLecturerProfile(course({ subjectName: "Human Computer Interaction" }), lecturer({ areaOfInterest: "HCI" })).interestStrength, 1);
  assert.equal(matchLecturerProfile(course({ subjectName: "Natural Language Processing" }), lecturer({ areaOfInterest: "NLP" })).interestStrength, 1);
});

test("shared generic words do not make education an artificial-intelligence match", () => {
  assert.equal(matchLecturerProfile(course({ subjectName: "Machine Learning" }), lecturer({ areaOfInterest: "Learning Approaches in Education" })).relevant, false);
});

test("broad computing specializations are explicitly marked as weaker matches", () => {
  const match = matchLecturerProfile(course({ subjectName: "Database Management" }), lecturer({ areaOfInterest: null, specialization: "Computer Science" }));
  assert.equal(match.specializationStrength, 0.2);
  assert.deepEqual(match.specializationMatches, ["Broad computing specialization"]);
});

test("workload is the first default priority, and specialization-first selection changes the decision", () => {
  const staff = [lecturer({ specialization: "Programming" }), lecturer({ id: 2, staffId: "1002", areaOfInterest: null, specialization: "Computer Science" })];
  const data = snapshot({ lecturers: staff, allocations: [allocation({ hoursPerWeek: 12 })] });
  assert.equal(buildAutoAssignmentPlan(data).proposals[0].lecturerId, 2);
  assert.equal(buildAutoAssignmentPlan({ ...data, priorities: ["specialization", "workload", "interest", "history"] }).proposals[0].lecturerId, 1);
  assert.equal(buildAutoAssignmentPlan({ ...data, priorities: ["specialization", "workload", "interest", "history"], allocations: [allocation({ hoursPerWeek: 18 })] }).proposals[0].lecturerId, 2);
});

test("specialization precedes interest when workload is tied; choosing interest first reverses the tie-break", () => {
  const data = snapshot({ lecturers: [lecturer({ areaOfInterest: null, specialization: "Programming" }), lecturer({ id: 2, staffId: "1002" })] });
  assert.equal(buildAutoAssignmentPlan(data).proposals[0].lecturerId, 1);
  assert.equal(buildAutoAssignmentPlan({ ...data, priorities: ["interest", "specialization", "workload", "history"] }).proposals[0].lecturerId, 2);
});

test("equal matches prefer the less-loaded lecturer and account for other teaching activities", () => {
  const staff = [lecturer(), lecturer({ id: 2, staffId: "1002" })];
  const plan = buildAutoAssignmentPlan(snapshot({ lecturers: staff, allocations: [allocation({ activityType: "OTHER", hoursPerWeek: 10 })] }));
  assert.equal(plan.proposals[0].lecturerId, 2);
  assert.equal(plan.proposals[0].beforeHours, 0);
});

test("weekly-hour loads are scoped to the selected coded term", () => {
  const plan = buildAutoAssignmentPlan(snapshot({ allocations: [allocation({ academicYearId: 2, hoursPerWeek: 20 })] }));
  assert.equal(plan.proposals[0].beforeHours, 0);
  assert.equal(plan.proposals[0].afterHours, 4);
});

test("course caps count distinct courses rather than L/T/P rows, retaining the manual API's all-years scope", () => {
  const threeSlots = ["LECTURE", "TUTORIAL", "PRACTICAL"].map((activityType) => allocation({ activityType, academicYearId: 2 }));
  assert.equal(buildAutoAssignmentPlan(snapshot({ allocations: threeSlots })).proposals.length, 1);
  const full = [99, 100, 101].map((subjectId) => allocation({ subjectId, academicYearId: 2 }));
  assert.equal(buildAutoAssignmentPlan(snapshot({ allocations: full })).proposals.length, 0);
  const diploma = snapshot({ courses: [course({ level: "Diploma" })], allocations: [99, 100, 101].map((subjectId) => allocation({ subjectId, level: "Diploma", academicYearId: 2 })) });
  assert.equal(buildAutoAssignmentPlan(diploma).proposals.length, 1);
});

test("draft totals are updated after each suggestion and limits are never forced", () => {
  const plan = buildAutoAssignmentPlan(snapshot({ lecturers: [lecturer({ maxHours: 7, minHours: 5 })], courses: [course(), course({ id: 2, subjectCode: "TEST1002" })] }));
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].afterHours, 4);
  assert.equal(plan.unassigned.length, 1);
});

test("courses with scarce candidates are considered before flexible courses", () => {
  const plan = buildAutoAssignmentPlan(snapshot({
    courses: [course({ subjectCode: "AAA1001" }), course({ id: 2, subjectCode: "ZZZ1002", subjectName: "Networking", tutorialHours: 0 })],
    lecturers: [lecturer({ areaOfInterest: "Programming, Networking", minHours: 3, maxHours: 5 }), lecturer({ id: 2, staffId: "1002", minHours: 3, maxHours: 5 })],
  }));
  assert.equal(plan.proposals.length, 2);
  assert.equal(plan.proposals[0].subjectCode, "ZZZ1002");
  assert.equal(plan.proposals[0].lecturerId, 1);
  assert.equal(plan.proposals[1].lecturerId, 2);
});

test("inactive lecturers and pending/approved workloads are excluded", () => {
  assert.equal(buildAutoAssignmentPlan(snapshot({ lecturers: [lecturer({ isActive: false })] })).proposals.length, 0);
  assert.equal(buildAutoAssignmentPlan(snapshot({ protectedLecturerIds: [1] })).proposals.length, 0);
  assert.equal(buildAutoAssignmentPlan(snapshot({ lecturers: [lecturer({ minHours: 22, maxHours: 20 })] })).proposals.length, 0);
});

test("existing partial or grouped teaching and inactive courses are preserved", () => {
  const plan = buildAutoAssignmentPlan(snapshot({ courses: [course(), course({ id: 2, subjectCode: "TEST1002", isActive: false })], allocations: [allocation({ subjectId: 1, groupName: "A" })] }));
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.existingCount, 1);
  assert.equal(plan.inactiveCount, 1);
});

test("unknown profiles/courses remain unassigned instead of being assigned randomly", () => {
  assert.equal(buildAutoAssignmentPlan(snapshot({ lecturers: [lecturer({ areaOfInterest: null })] })).proposals.length, 0);
  assert.equal(buildAutoAssignmentPlan(snapshot({ courses: [course({ subjectName: "History" })] })).proposals.length, 0);
});

test("matching prior teaching can supply evidence when specialization and interests are missing", () => {
  const data = snapshot({ lecturers: [lecturer({ areaOfInterest: null })], teachingHistory: [historical()] });
  const plan = buildAutoAssignmentPlan(data);
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].historyMatches[0].subjectCode, "OLD1001");
  assert.equal(plan.proposals[0].historyMatches[0].matchType, "same_course");
  assert.equal(plan.historyRecordCount, 1);
});

test("history is the final default tie-break, or can be selected as first priority", () => {
  const history = [historical({ lecturerId: 2 })];
  const tied = snapshot({ lecturers: [lecturer(), lecturer({ id: 2, staffId: "1002" })], teachingHistory: history });
  assert.equal(buildAutoAssignmentPlan(tied).proposals[0].lecturerId, 2);
  const differentLoads = { ...tied, allocations: [allocation({ lecturerId: 2, hoursPerWeek: 8, activityType: "OTHER" })] };
  assert.equal(buildAutoAssignmentPlan(differentLoads).proposals[0].lecturerId, 1);
  assert.equal(buildAutoAssignmentPlan({ ...differentLoads, priorities: ["history", "workload", "specialization", "interest"] }).proposals[0].lecturerId, 2);
});

test("current, future and not-yet-completed historical records never count as previous teaching", () => {
  const noProfile = [lecturer({ areaOfInterest: null })];
  for (const record of [historical({ academicYearId: 1 }), historical({ endDate: "2027-04-11" }), historical({ endDate: "2026-09-22" })]) {
    const plan = buildAutoAssignmentPlan(snapshot({ lecturers: noProfile, teachingHistory: [record] }));
    assert.equal(plan.proposals.length, 0);
    assert.equal(plan.historyRecordCount, 0);
  }
  const futureSelection = snapshot({ term: { id: 7, label: "202805", weekCount: 14, startDate: "2028-05-08" }, courses: [course({ academicYearId: 7 })], lecturers: noProfile, teachingHistory: [historical({ endDate: "2027-04-11" })] });
  assert.equal(buildAutoAssignmentPlan(futureSelection).proposals.length, 0);
});

test("history is deduplicated across slots and unrelated historical courses cannot establish a match", () => {
  const duplicate = historical();
  const match = matchTeachingHistory(course(), 1, [duplicate, duplicate]);
  assert.equal(match.count, 1);
  assert.equal(match.strength, 1);
  assert.equal(buildAutoAssignmentPlan(snapshot({ teachingHistory: [duplicate, duplicate] })).historyRecordCount, 1);
  assert.equal(matchTeachingHistory(course(), 1, [historical({ subjectName: "Mathematics" })]).count, 0);
  assert.equal(matchTeachingHistory(course({ subjectName: "Computer Networks" }), 1, [historical({ subjectName: "Enterprise Networking" })]).matches[0].matchType, "related_topic");
});

test("unknown or duplicate priority selections are refused; defaults use workload, specialization, interest, history", () => {
  assert.deepEqual(parseAutoAssignmentRequest({ action: "preview", academicYearId: 1 }).priorities, ["workload", "specialization", "interest", "history"]);
  for (const priorities of [null, [], ["workload"], ["workload", "workload", "interest", "history"], ["workload", "specialization", "interest", "unknown"]]) {
    assert.equal(isAssignmentPriorityOrder(priorities), false);
    assert.throws(() => parseAutoAssignmentRequest({ action: "preview", academicYearId: 1, priorities }));
  }
  assert.equal(isAssignmentPriorityOrder(["history", "interest", "specialization", "workload"]), true);
});

test("term/programme scope is enforced and identical inputs give identical plans", () => {
  const data = snapshot({ programmeCode: "RSD", courses: [course(), course({ id: 2, subjectCode: "OTHER", academicYearId: 2 }), course({ id: 3, subjectCode: "DFT1", programmeCode: "DFT" })] });
  assert.equal(buildAutoAssignmentPlan(data).proposals.length, 1);
  assert.deepEqual(buildAutoAssignmentPlan(data), buildAutoAssignmentPlan(JSON.parse(JSON.stringify(data))));
});

test("malformed scopes and unreviewed saves are rejected before database access", () => {
  for (const invalid of [null, [], {}, { action: "preview", academicYearId: true }, { action: "preview", academicYearId: 0 }, { action: "commit", academicYearId: 1 }, { action: "preview", academicYearId: 1, programmeCode: "'; DROP TABLE subjects;" }]) {
    assert.throws(() => parseAutoAssignmentRequest(invalid));
  }
  assert.equal(parseAutoAssignmentRequest({ action: "preview", academicYearId: "2", programmeCode: null }).academicYearId, 2);
});
