/**
 * SITE CONFIG — single source for login-page branding + rotating notices.
 * Static today; can later be served from an API without touching the UI.
 */
export const site = {
  /** Wordmark lines under the crest (rendered top-to-bottom). */
  university: ["Tunku Abdul Rahman", "University of Management", "and Technology"],
  /** Page title (rendered with the ShinyText color sweep). */
  systemTitle: "Workload Allocation System",
  /** Rotating notices on the login page (short, single line each). */
  notices: [
    "Workload allocations for the new academic session open on Monday.",
    "Submit OT claims before the end-of-term cut-off.",
    "New course records are published by the department administrator.",
    "Workload reports refresh nightly at 1:00 AM.",
  ],
} as const;
