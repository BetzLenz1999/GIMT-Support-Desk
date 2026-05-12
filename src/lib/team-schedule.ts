export type TeamMember = {
  id: string;
  name: string;
  timezone: string;
  shiftStartUtc: string;
  shiftEndUtc: string;
};

export const TEAM_SCHEDULE: TeamMember[] = [
  {
    id: "betz",
    name: "Betz",
    timezone: "Asia/Manila",
    shiftStartUtc: "00:00",
    shiftEndUtc: "05:00"
  },
  {
    id: "omar",
    name: "Omar",
    timezone: "Africa/Lagos",
    shiftStartUtc: "05:00",
    shiftEndUtc: "10:00"
  },
  {
    id: "moh",
    name: "Moh",
    timezone: "Africa/Lagos",
    shiftStartUtc: "10:00",
    shiftEndUtc: "15:00"
  },
  {
    id: "pablo",
    name: "Pablo",
    timezone: "America/Argentina/Buenos_Aires",
    shiftStartUtc: "15:00",
    shiftEndUtc: "20:00"
  },
  {
    id: "dany",
    name: "Dany",
    timezone: "America/Bogota",
    shiftStartUtc: "20:00",
    shiftEndUtc: "01:00"
  }
];

export function getTeamMember(memberId: string): TeamMember | undefined {
  return TEAM_SCHEDULE.find((member) => member.id === memberId);
}

export function getOtherMembers(memberId: string): TeamMember[] {
  return TEAM_SCHEDULE.filter((member) => member.id !== memberId);
}

export function getNextScheduledMember(memberId: string): TeamMember | undefined {
  const index = TEAM_SCHEDULE.findIndex((member) => member.id === memberId);
  if (index === -1) return undefined;
  return TEAM_SCHEDULE[(index + 1) % TEAM_SCHEDULE.length];
}
