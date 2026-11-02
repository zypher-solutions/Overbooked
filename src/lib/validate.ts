// Checks for what people type into forms. Each returns a message for the person, or null when the value is fine.
// The same functions run in the browser (shown under the field) and in the server actions (never trust the browser).
// A blank optional value is fine; required ones say so.

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const normalizeEmail = (v: string) => v.trim().toLowerCase();

export function emailError(v: string, required = true): string | null {
  const e = v.trim();
  if (!e) return required ? "Enter the email." : null;
  if (e.length > 254 || !EMAIL_RE.test(e)) return "Enter a valid email, like name@example.com.";
  return null;
}

// Indian mobile numbers: 10 digits starting with 6 to 9. "+91 98470 12345", "098470-12345" and "9847012345" are all accepted.
export function normalizePhone(v: string): string {
  let d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function phoneError(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Enter the phone number." : null;
  const d = normalizePhone(v);
  if (d.length !== 10) return "Enter a 10-digit mobile number.";
  if (!/^[6-9]/.test(d)) return "A mobile number starts with 6, 7, 8 or 9.";
  return null;
}

// a person's name: letters, spaces and . ' - only
export function personNameError(v: string, label = "name"): string | null {
  const n = v.trim().replace(/\s+/g, " ");
  if (!n) return `Enter the ${label}.`;
  if (n.length < 2) return `The ${label} is too short.`;
  if (n.length > 60) return `The ${label} is too long (60 letters at most).`;
  if (!/^[\p{L}][\p{L}\s.'-]*$/u.test(n)) return `The ${label} can use letters, spaces and . ' - only.`;
  return null;
}

// a shop, branch or category name: letters and numbers with a few marks
export function businessNameError(v: string, label = "name", max = 60): string | null {
  const n = v.trim().replace(/\s+/g, " ");
  if (!n) return `Enter the ${label}.`;
  if (n.length < 2) return `The ${label} is too short.`;
  if (n.length > max) return `The ${label} is too long (${max} characters at most).`;
  if (!/\p{L}/u.test(n)) return `The ${label} needs at least one letter.`;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s&.,'()/-]*$/u.test(n)) return `The ${label} has a character that is not allowed.`;
  return null;
}

export function slugError(v: string): string | null {
  if (!v) return "Enter the web name.";
  if (v.length < 3) return "The web name needs at least 3 characters.";
  if (v.length > 40) return "The web name can be 40 characters at most.";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return "Use small letters, numbers and single dashes only.";
  return null;
}

export function prefixError(v: string): string | null {
  return /^[A-Z]{2,6}$/.test(v) ? null : "The booking prefix needs 2 to 6 capital letters.";
}

// money typed by hand: a plain number, at most two decimals
export function amountError(v: string, { required = false, max = 10_000_000 } = {}): string | null {
  const t = v.trim();
  if (!t) return required ? "Enter the amount." : null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Enter a number like 600 or 599.50.";
  if (Number(t) > max) return "That amount is too large.";
  return null;
}

export function addressError(v: string): string | null {
  return v.trim().length > 200 ? "The address is too long (200 characters at most)." : null;
}

// India's GST number: 15 characters, e.g. 32ABCDE1234F1Z5 (blank is fine when a shop has none)
export function gstinError(v: string): string | null {
  const g = v.trim().toUpperCase();
  if (!g) return null;
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g) ? null : "A GST number has 15 characters, like 32ABCDE1234F1Z5.";
}

// An amount of money typed in a box: a plain number, at most two decimals, optionally above zero and not above a limit.
export function moneyError(v: string, o: { label?: string; required?: boolean; positive?: boolean; max?: number; maxText?: string } = {}): string | null {
  const label = o.label ?? "amount";
  const t = v.trim();
  if (!t) return o.required ? `Enter the ${label}.` : null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return `The ${label} must be a number like 600 or 599.50.`;
  const n = Number(t);
  if (o.positive && n <= 0) return `The ${label} must be more than zero.`;
  if (o.max !== undefined && n > o.max) return `The ${label} cannot be more than ${o.maxText ?? "₹" + o.max.toLocaleString("en-IN")}.`;
  return null;
}

// a reason written for the record (corrections, cancellations): a few real words
export function reasonError(v: string, label = "reason", min = 3, max = 300): string | null {
  const t = v.trim();
  if (t.length < min) return `Write the ${label} (at least ${min} characters).`;
  if (t.length > max) return `The ${label} is too long (${max} characters at most).`;
  return null;
}

// free text that may be blank: only a length limit
export function textLimitError(v: string, label = "note", max = 500): string | null {
  return v.trim().length > max ? `The ${label} is too long (${max} characters at most).` : null;
}
