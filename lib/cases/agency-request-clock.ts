export type AgencyCaseKind = "dataq" | "cpdp";
export type AgencyRequest = {
  id: string;
  client_id: string;
  case_kind: AgencyCaseKind;
  case_id: string;
  requested_on: string;
  response_due: string;
  requesting_agency: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  request_text: string;
  status: "open" | "responded" | "lapsed";
  responded_on: string | null;
  response_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function pacificDateOnly(now: Date | string = new Date()): string {
  if (typeof now === "string" && /^\d{4}-\d{2}-\d{2}$/.test(now)) {
    dateMillis(now);
    return now;
  }
  const date = typeof now === "string" ? new Date(now) : now;
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid calendar date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateMillis(value: string): number {
  const time = Date.parse(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return time;
}

export function defaultResponseDue(requestedOn: string): string {
  return new Date(dateMillis(requestedOn) + 10 * 86_400_000).toISOString().slice(0, 10);
}

export function responseClock(request: Pick<AgencyRequest, "response_due">, today: string | Date) {
  const daysLeft = Math.round((dateMillis(request.response_due) - dateMillis(pacificDateOnly(today))) / 86_400_000);
  const state: "ok" | "due_soon" | "overdue" = daysLeft < 0 ? "overdue" : daysLeft <= 3 ? "due_soon" : "ok";
  return { daysLeft, state };
}

export function responseClockText(request: Pick<AgencyRequest, "response_due">, today: string | Date) {
  const { daysLeft, state } = responseClock(request, today);
  if (state === "overdue") return `Overdue by ${Math.abs(daysLeft)} days — case may auto-close`;
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(dateMillis(request.response_due)));
  return `Respond by ${date} · ${daysLeft} days left`;
}
