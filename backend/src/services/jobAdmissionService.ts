import type { Job } from "../types/index.js";

const AGENT_MANAGED_BUDGET_ADMISSION_ACTIONS = new Set<Job["action"]>([
  "deep_dive",
  "full_report",
]);

export function requiresBudgetAdmission(job: Pick<Job, "action">): boolean {
  return AGENT_MANAGED_BUDGET_ADMISSION_ACTIONS.has(job.action);
}

export function isBudgetAdmittedJob(
  job: Pick<Job, "action" | "budget_admitted_at">
): boolean {
  return requiresBudgetAdmission(job) && typeof job.budget_admitted_at === "string";
}
