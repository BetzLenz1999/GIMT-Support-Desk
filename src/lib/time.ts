import type { TeamMember } from "./team-schedule.js";

export const GRACE_PERIOD_MINUTES = 5;
export const EARLY_TIME_IN_GRACE_MINUTES = 15;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type ShiftWindow = {
  workDateUtc: string;
  start: Date;
  end: Date;
};

export function formatUtc(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date).replace(",", "");
}

export function formatLocal(date: Date, timezone: string): string {
  return `${new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date).replace(",", "")} ${timezone}`;
}

export function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;

  if (hours === 0) {
    return `${sign}${minutes}m`;
  }

  if (minutes === 0) {
    return `${sign}${hours}h`;
  }

  return `${sign}${hours}h ${minutes}m`;
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS));
}

export function signedMinutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseUtcTimeForDate(dateKey: string, utcTime: string): Date {
  return new Date(`${dateKey}T${utcTime}:00.000Z`);
}

export function getShiftWindowForDate(member: TeamMember, dateKey: string): ShiftWindow {
  const start = parseUtcTimeForDate(dateKey, member.shiftStartUtc);
  let end = parseUtcTimeForDate(dateKey, member.shiftEndUtc);

  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + DAY_MS);
  }

  return { workDateUtc: dateKey, start, end };
}

export function getRelevantShiftWindow(member: TeamMember, now = new Date()): ShiftWindow {
  const today = utcDateKey(now);
  const yesterday = utcDateKey(new Date(now.getTime() - DAY_MS));
  const tomorrow = utcDateKey(new Date(now.getTime() + DAY_MS));
  const todayWindow = getShiftWindowForDate(member, today);
  const yesterdayWindow = getShiftWindowForDate(member, yesterday);
  const tomorrowWindow = getShiftWindowForDate(member, tomorrow);
  const postShiftBufferMs = 2 * 60 * MINUTE_MS;

  if (now.getTime() <= yesterdayWindow.end.getTime() + postShiftBufferMs) {
    return yesterdayWindow;
  }

  if (now.getTime() <= todayWindow.end.getTime() + postShiftBufferMs) {
    return todayWindow;
  }

  return tomorrowWindow;
}

export function getShiftProgress(member: TeamMember, now = new Date()): string {
  const window = getRelevantShiftWindow(member, now);

  if (now < window.start) {
    return `Starts in ${formatDuration(minutesBetween(now, window.start))}`;
  }

  if (now <= window.end) {
    return `Shift active — ${formatDuration(minutesBetween(now, window.end))} remaining`;
  }

  return `Shift ended ${formatDuration(minutesBetween(window.end, now))} ago`;
}

export function calculateLateMinutes(scheduledStart: Date, actualIn: Date): number {
  const lateMinutes = signedMinutesBetween(scheduledStart, actualIn) - GRACE_PERIOD_MINUTES;
  return Math.max(0, lateMinutes);
}

export function isTooEarlyToTimeIn(
  scheduledStart: Date,
  now: Date,
  graceMinutes: number = EARLY_TIME_IN_GRACE_MINUTES
): boolean {
  return signedMinutesBetween(now, scheduledStart) > graceMinutes;
}

export function calculateEarlyOutMinutes(scheduledEnd: Date, actualOut: Date): number {
  return Math.max(0, signedMinutesBetween(actualOut, scheduledEnd));
}

export function calculateOvertimeMinutes(scheduledEnd: Date, actualOut: Date): number {
  return Math.max(0, signedMinutesBetween(scheduledEnd, actualOut));
}
