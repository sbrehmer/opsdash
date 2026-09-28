export interface JiraRef {
  key: string;
}

export interface JiraSettings {
  deployment: "cloud" | "datacenter";
  baseUrl: string;
  email?: string;
  token: { env: string };
  projectKeys: string[];
}

export type StatusCategory = "todo" | "inprogress" | "done";

export interface JiraIssue {
  key: string;
  url: string;
  title: string;
  status: string;
  category: StatusCategory;
  assignee: string | null;
}

export const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
