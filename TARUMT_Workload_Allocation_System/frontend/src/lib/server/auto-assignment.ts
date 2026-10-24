// One engine for the dedicated API and its same-origin fallback, so matching,
// preview fingerprints and transaction safeguards cannot drift between them.
export {
  handleAutoAssignment,
  lockAssignmentWrites,
  checkTeachingHourLimits,
} from "../../../../backend-express/src/services/auto-assignment-service";
export type { AutoAssignmentPlan } from "../../../../backend-express/src/services/auto-assignment";
