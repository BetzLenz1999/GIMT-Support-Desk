export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}


export function isTeamInboxEnabled(): boolean {
  return (process.env.TEAM_INBOX_MODE || "").trim().toLowerCase() === "on";
}

export type SupportMode = "old" | "ai";

export function getSupportMode(): SupportMode {
  const rawValue = (process.env.SUPPORT_MODE || "old").trim().toLowerCase();
  if (rawValue === "ai" || rawValue === "old") return rawValue;

  console.warn(`Invalid SUPPORT_MODE=${process.env.SUPPORT_MODE}. Falling back to old support flow.`);
  return "old";
}
