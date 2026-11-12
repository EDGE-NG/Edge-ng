export type Category = "entry" | "context" | "confirmation" | "invalidation" | "risk" | "note";
export type Assessability = "chart" | "context_needed" | "manual";

export interface Rule {
  id?: string;
  category: Category;
  text: string;
  hard_gate: boolean;
  assessability: Assessability;
  required_timeframe: string | null;
  source_span: string | null;
}

export interface ChecklistPayload {
  rules: Rule[];
  questions: string[];
  versionNumber: number;
  rejected: number;
}

export interface Message {
  id: string;
  role: "trader" | "edge";
  kind: "text" | "checklist" | "error";
  content: string;
  payload: ChecklistPayload | null;
  via_voice: boolean;
  created_at: string;
  pending?: boolean;
}

export interface Draft {
  edgeId: string;
  edgeName: string;
  versionId: string;
  versionNumber: number;
  items: Rule[];
  approvedVersionNumber: number | null;
  dirty: boolean;
}

export interface ChatSummary {
  id: string;
  purpose: string;
  title: string | null;
  edge_id: string | null;
  updated_at: string;
}

export interface ChatSummaryWithEdge extends ChatSummary {
  edge_name?: string | null;
  approved_version?: number | null;
  rule_count?: number;
  hard_count?: number;
}

export interface ChatView {
  chat: ChatSummary;
  messages: Message[];
  draft: Draft | null;
  openQuestions: string[];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  entry: "Entry",
  context: "Context",
  confirmation: "Confirmation",
  invalidation: "Invalidation",
  risk: "Risk",
  note: "Notes",
};
export const CATEGORY_ORDER: Category[] = ["entry", "context", "confirmation", "invalidation", "risk", "note"];

export const ASSESS_LABEL: Record<Assessability, string> = {
  chart: "Seen on chart",
  context_needed: "Needs context",
  manual: "You confirm",
};

export const PURPOSE_LABEL: Record<string, string> = {
  build_edge: "Build an edge",
  update_edge: "Update an edge",
  review_trade: "Review a trade",
};

export const MAX_MESSAGE_CHARS = 6000;
