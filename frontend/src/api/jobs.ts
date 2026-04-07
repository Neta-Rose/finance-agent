import { apiClient } from "./client";
import type { Job, JobsResponse, TriggerResponse, JobAction } from "../types/api";

export const fetchJobs = async (): Promise<JobsResponse> =>
 (await apiClient.get<JobsResponse>("/jobs")).data;

export const fetchJob = async (jobId: string): Promise<Job> =>
 (await apiClient.get<Job>(`/jobs/${jobId}`)).data;

export const triggerJob = async (
 action: JobAction,
 ticker?: string
): Promise<TriggerResponse> =>
 (await apiClient.post<TriggerResponse>("/jobs/trigger", { action, ticker })).data;
