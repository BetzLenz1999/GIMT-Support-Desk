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


export type SupportMode = "old" | "ai";

export const DEFAULT_SUPPORT_MODE: SupportMode = "ai";

export function getSupportMode(): SupportMode {
  const rawValue = (process.env.SUPPORT_MODE || DEFAULT_SUPPORT_MODE).trim().toLowerCase();
  if (rawValue === "ai" || rawValue === "old") return rawValue;

  console.warn(`Invalid SUPPORT_MODE=${process.env.SUPPORT_MODE}. Falling back to ${DEFAULT_SUPPORT_MODE} support flow.`);
  return DEFAULT_SUPPORT_MODE;
}
