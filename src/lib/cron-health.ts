import { optionalEnv } from "./config.js";
import { sendTeamGroupMessage } from "./group-notifications.js";
import { createActivity, getAppSetting, upsertAppSetting } from "./repository.js";
import type { SupabaseRestClient } from "./supabase.js";
import { formatDuration, formatUtc } from "./time.js";

/** app_settings key holding the ISO timestamp of the last successful timekeeping run. */
export const CRON_HEARTBEAT_KEY = "timekeeping_cron_last_run_at";
/** app_settings key holding the alert key already sent for the current stale period. */
export const CRON_STALE_ALERT_KEY = "timekeeping_cron_stale_alert_key";

const STALE_ALERT_ACTIVITY_ACTION = "CRON_STALE_ALERT";

const DEFAULT_STALE_AFTER_MINUTES = 45;
const DEFAULT_REALERT_HOURS = 6;
const MINUTE_MS = 60_000;

function positiveNumberEnv(name: string, fallback: number): number {
  const raw = Number(optionalEnv(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Minutes without a successful run before the cron is considered stalled. */
export function staleAfterMinutes(): number {
  return positiveNumberEnv("CRON_STALE_AFTER_MINUTES", DEFAULT_STALE_AFTER_MINUTES);
}

/** Minimum hours between repeated stale alerts while the cron stays down. */
export function realertHours(): number {
  return positiveNumberEnv("CRON_STALE_REALERT_HOURS", DEFAULT_REALERT_HOURS);
}

export type CronFreshness = {
  lastRunAt: Date | null;
  ageMinutes: number | null;
  stale: boolean;
  staleAfterMinutes: number;
  reason: "no_heartbeat_recorded" | "heartbeat_stale" | null;
};

function parseStoredTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reads the last recorded run and reports whether it is older than the stale
 * threshold. A missing heartbeat is treated as stale so a deployment that never
 * ran the cron (or one whose scheduler died before the first run) is flagged
 * instead of silently reported healthy.
 */
export async function readCronFreshness(db: SupabaseRestClient, now = new Date()): Promise<CronFreshness> {
  const threshold = staleAfterMinutes();
  const lastRunAt = parseStoredTimestamp(await getAppSetting(db, CRON_HEARTBEAT_KEY));

  if (!lastRunAt) {
    return { lastRunAt: null, ageMinutes: null, stale: true, staleAfterMinutes: threshold, reason: "no_heartbeat_recorded" };
  }

  const ageMinutes = Math.max(0, Math.round((now.getTime() - lastRunAt.getTime()) / MINUTE_MS));
  const stale = ageMinutes > threshold;
  return {
    lastRunAt,
    ageMinutes,
    stale,
    staleAfterMinutes: threshold,
    reason: stale ? "heartbeat_stale" : null
  };
}

/** Records a successful cron run so the next run or /api/cron/health can detect a stalled scheduler. */
export async function recordCronHeartbeat(db: SupabaseRestClient, now = new Date()): Promise<void> {
  await upsertAppSetting(db, CRON_HEARTBEAT_KEY, now.toISOString());
}

function staleAlertKey(lastRunAt: Date | null, now: Date): string {
  const windowBucket = Math.floor(now.getTime() / (realertHours() * 60 * MINUTE_MS));
  // Including the last run means a fresh outage (new last-run value) alerts even
  // if it starts inside the same re-alert window as a previous one.
  return `${lastRunAt?.getTime() ?? "none"}:${windowBucket}`;
}

export type CronStalenessResult = CronFreshness & { alerted: boolean };

/**
 * Posts a one-time team alert when the previous heartbeat is older than the
 * stale threshold.
 *
 * This is the fix for the silent outage that a locked GitHub account causes:
 * every scheduled run stops without any error reaching the team, so reminders
 * vanish with no signal. Checking staleness from the next run (or from a
 * manual /api/cron/health hit) surfaces the gap instead of leaving it
 * invisible. Re-alerts at most once per re-alert window per stale period, and
 * only when a team group chat is configured.
 */
export async function checkCronStaleness(db: SupabaseRestClient, now = new Date()): Promise<CronStalenessResult> {
  const freshness = await readCronFreshness(db, now);
  const result: CronStalenessResult = { ...freshness, alerted: false };
  // Only alert when a previously running cron stopped. A deployment that has
  // never recorded a heartbeat (first setup) stays quiet to avoid a false alarm
  // in the team group; /api/cron/health still reports it as stale so a monitor
  // catches a scheduler that never started.
  if (!freshness.stale || freshness.reason !== "heartbeat_stale") return result;

  const alertKey = staleAlertKey(freshness.lastRunAt, now);
  if ((await getAppSetting(db, CRON_STALE_ALERT_KEY)) === alertKey) return result;

  const lastRunText = freshness.lastRunAt
    ? `${formatUtc(freshness.lastRunAt)} UTC (${formatDuration(freshness.ageMinutes ?? 0)} ago)`
    : "never recorded";

  const message =
    "⚠️ <b>Timekeeping cron gap detected</b>\n\n" +
    `Last successful run: ${lastRunText}\n` +
    `Alert threshold: ${freshness.staleAfterMinutes} minutes\n\n` +
    "Shift reminders may have been skipped since then — Time In, Time Out, proof-of-work, and assistant-today intros all depend on this cron.\n" +
    "Check the scheduler (GitHub Actions or an external cron) and the /api/cron/timekeeping endpoint.";

  const sent = await sendTeamGroupMessage(message, { parseMode: "HTML" });
  if (!sent) return result;

  await upsertAppSetting(db, CRON_STALE_ALERT_KEY, alertKey);
  await createActivity(db, {
    member_id: "system",
    member_name: "System",
    telegram_user_id: null,
    action: STALE_ALERT_ACTIVITY_ACTION,
    message: `Timekeeping cron stale: last run ${lastRunText}.`,
    metadata: {
      lastRunAt: freshness.lastRunAt?.toISOString() ?? null,
      ageMinutes: freshness.ageMinutes,
      staleAfterMinutes: freshness.staleAfterMinutes,
      reason: freshness.reason
    }
  });

  result.alerted = true;
  return result;
}
