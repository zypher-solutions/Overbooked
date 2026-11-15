// Employees without email log in with a username like "ravi@zeez-rental" (name @ shop web name, migration 049).
// Supabase needs an email per account, so the account's email is a hidden one on the reserved ".invalid" domain,
// which can never receive mail. Anything with a dot after the @ is a normal email.
const HIDDEN_DOMAIN = "staff.overbooked.invalid";
const NAME_RE = /^[a-z0-9][a-z0-9._]{1,29}$/;

export function isUsername(v: string) {
  const parts = v.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "" && !parts[1].includes(".");
}

// what Supabase signs in with: the hidden email for a username, the email itself otherwise
export function loginEmail(v: string) {
  const s = v.trim().toLowerCase();
  if (!isUsername(s)) return s;
  const [name, shop] = s.split("@");
  return `${name}@${shop}.${HIDDEN_DOMAIN}`;
}

export function usernameNameError(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return "Enter a username.";
  if (!NAME_RE.test(n)) return "A username is 2 to 30 letters or numbers (dots and _ allowed), starting with a letter or number.";
  return null;
}
