import type { StatusKind, TurnEnd } from "./types";

const ERROR_LABELS: Record<string, string> = {
  rate_limit: "Rate limited",
  overloaded: "Overloaded",
  authentication_failed: "Auth failed",
  oauth_org_not_allowed: "Auth failed",
  billing_error: "Billing error",
  server_error: "Server error",
  max_output_tokens: "Output too long",
};

export function errorLabel(error: string | undefined): string {
  return (error && ERROR_LABELS[error]) || "API error";
}

// An idle session whose turn ended on a question or an error reads as
// asking or crashed on screen; gates keep reading the raw kind.
export function displayKind(s: {
  kind: StatusKind;
  ended?: TurnEnd | "";
}): StatusKind {
  if (s.kind !== "idle") return s.kind;
  if (s.ended === "question") return "asking";
  if (s.ended === "failed") return "crashed";
  return s.kind;
}

export function endLabel(s: {
  ended?: TurnEnd | "";
  error?: string;
}): string | null {
  if (s.ended === "finished") return "Finished";
  if (s.ended === "question") return "Asking question";
  if (s.ended === "failed") return errorLabel(s.error);
  return null;
}
