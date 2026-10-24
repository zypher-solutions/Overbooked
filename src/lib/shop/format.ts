// Money and time for the shop app. Times are shown and entered in the shop's time zone
// (India for every shop today), whatever the device's own clock says.

export const DEFAULT_TZ = "Asia/Kolkata";

export function rupees(n: number | string | null | undefined) {
  const v = Math.round(Number(n ?? 0) * 100) / 100;
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// a number typed into a form, or 0
export function num(v: string | number | null | undefined) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// minutes the zone is ahead of UTC at a given moment
function offsetMinutes(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

// "2026-10-31T14:00" in the shop's zone -> ISO instant
export function zonedToIso(local: string, tz = DEFAULT_TZ) {
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const first = guess - offsetMinutes(new Date(guess), tz) * 60000;
  const second = guess - offsetMinutes(new Date(first), tz) * 60000;
  return new Date(second).toISOString();
}

// ISO instant -> "2026-10-31T14:00" in the shop's zone (for datetime-local inputs)
export function isoToZoned(iso: string, tz = DEFAULT_TZ) {
  const at = new Date(iso);
  const local = new Date(at.getTime() + offsetMinutes(at, tz) * 60000);
  return local.toISOString().slice(0, 16);
}

export function todayLocal(tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function addDays(isoDate: string, days: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// start and end of a local day as instants
export function dayRange(isoDate: string, tz = DEFAULT_TZ) {
  return { from: zonedToIso(isoDate + "T00:00", tz), to: zonedToIso(addDays(isoDate, 1) + "T00:00", tz) };
}

export function fmtDate(iso: string | null | undefined, tz = DEFAULT_TZ) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso)
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : tz });
}

export function fmtDateTime(iso: string | null | undefined, tz = DEFAULT_TZ) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function fmtTime(iso: string, tz = DEFAULT_TZ) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

// "3 days", "5 hours", "2 nights"
export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// how a priced line was worked out: "₹2,500 × 2 days", "1 day 4 hours", "₹4,500 × 2 nights × 2"
export function lineMath(l: { rate_type: string; rate: number; time_units: number; qty: number }) {
  const n = Number(l.time_units);
  const times = l.qty > 1 ? ` × ${l.qty}` : "";
  if (l.rate_type === "hour_day") {
    const days = Math.floor(n / 24);
    const hours = n % 24;
    return [days ? plural(days, "day") : "", hours ? plural(hours, "hour") : ""].filter(Boolean).join(" ") + times;
  }
  const unit = { day: "day", night: "night", hour: "hour", driver_day: "day", extra_person: "night" }[l.rate_type];
  return `${rupees(l.rate)} × ${unit ? plural(n, unit) : n}${times}`;
}

// Postgres interval text ("1 day", "03:00:00", "1 day 02:00:00") in words
export function fmtInterval(value: string | null | undefined) {
  if (!value) return "none";
  const parts: string[] = [];
  const days = value.match(/(\d+) days?/);
  if (days) parts.push(plural(Number(days[1]), "day"));
  const time = value.match(/(\d+):(\d+):(\d+)/);
  if (time) {
    if (Number(time[1])) parts.push(plural(Number(time[1]), "hour"));
    if (Number(time[2])) parts.push(`${Number(time[2])} minutes`);
  }
  return parts.join(" ") || "none";
}

// interval text -> hours, for the product form
export function intervalHours(value: string | null | undefined) {
  if (!value) return 0;
  const days = Number(value.match(/(\d+) days?/)?.[1] ?? 0);
  const time = value.match(/(\d+):(\d+):(\d+)/);
  return days * 24 + (time ? Number(time[1]) + Number(time[2]) / 60 : 0);
}

export const METHOD_LABELS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer" };

export const STATUS_LABELS: Record<string, string> = {
  reserved: "Booked", active: "Out", completed: "Returned", cancelled: "Cancelled", no_show: "No-show",
};

export const CHARGE_LABELS: Record<string, string> = {
  late: "Late return", extra_km: "Extra km", fuel: "Fuel", damage: "Damage", lost: "Lost item", cleaning: "Cleaning",
  toll: "Toll", parking: "Parking", challan: "Traffic fine (challan)", alteration: "Alteration", extra_person: "Extra person",
  other: "Other",
};

export const RATE_LABELS: Record<string, string> = {
  hour: "Per hour", day: "Per day", night: "Per night", extra_km: "Per extra km", extra_hour: "Per late hour",
  extra_person: "Per extra guest per night", driver_day: "Driver per day", late_penalty: "Late penalty (once)",
};

export const BASIS_LABELS: Record<string, string> = {
  per_rental: "once per booking", per_day: "per day", per_unit_day: "per unit per day", per_person_night: "per guest per night",
};

export const PAYMENT_LABELS: Record<string, string> = {
  payment: "Payment", refund: "Refund", deposit: "Deposit received", deposit_refund: "Deposit returned",
  deposit_applied: "Deposit kept",
};

export const FEATURE_LABELS: Record<string, string> = {
  sets: "Sets", measurements: "Customer measurements", alterations: "Alterations", appointments: "Appointments",
  guests: "Guest counts", meal_plans: "Meal plans", whole_property: "Whole-property booking", with_driver: "With driver",
};

// a database error as a sentence for the person at the counter
export function errorText(e: unknown) {
  const msg = (e as { message?: string })?.message ?? String(e ?? "");
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "No connection. Check the internet and try again.";
  if (/JWT|session/i.test(msg)) return "Your session ended. Please sign in again.";
  return msg || "Something went wrong.";
}
