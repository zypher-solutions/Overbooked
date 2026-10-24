// WhatsApp messages the counter sends from its own phone (no WhatsApp Business API).
import { fmtDateTime, rupees } from "./format";
import type { RentalDetail } from "./api";

export type MessageKind = "confirmation" | "pickup_reminder" | "return_reminder" | "receipt";

export const MESSAGE_LABELS: Record<MessageKind, string> = {
  confirmation: "Booking confirmation",
  pickup_reminder: "Reminder before pickup",
  return_reminder: "Reminder to return",
  receipt: "Thank you and receipt",
};

export function waLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length > 10 ? digits : "91" + digits;
  return `https://api.whatsapp.com/send/?phone=${full}&text=${encodeURIComponent(text)}`;
}

export function buildMessage(kind: MessageKind, r: RentalDetail, ctx: {
  shopName: string; branchName?: string; branchPhone?: string | null; tz: string; startWord: string; endWord: string;
}) {
  const items = r.rental_lines.filter((l) => l.rate_type !== "driver_day" && l.rate_type !== "extra_person")
    .map((l) => `• ${l.qty > 1 ? `${l.qty} × ` : ""}${l.description}`).join("\n");
  const balance = Number(r.total) - Number(r.paid);
  const name = r.customers.full_name.split(" ")[0];
  const at = (iso: string) => fmtDateTime(iso, ctx.tz);
  const contact = ctx.branchPhone ? `\nQuestions? Call ${ctx.branchPhone}.` : "";

  switch (kind) {
    case "confirmation":
      return [
        `Hi ${name}, your booking with *${ctx.shopName}* is confirmed.`,
        ``,
        `Booking no.: *${r.token}*`,
        items,
        `${ctx.startWord}: ${at(r.start_at)}`,
        `${ctx.endWord}: ${at(r.end_at)}`,
        ctx.branchName ? `Branch: ${ctx.branchName}` : "",
        ``,
        `Total: ${rupees(r.total)} · Paid: ${rupees(r.paid)}${balance > 0 ? ` · Balance: ${rupees(balance)}` : ""}`,
        Number(r.deposit_agreed) > 0 ? `Refundable deposit: ${rupees(r.deposit_agreed)}` : "",
        contact,
      ].filter((x) => x !== "").join("\n");
    case "pickup_reminder":
      return [
        `Hi ${name}, a reminder from *${ctx.shopName}*: your booking *${r.token}* starts ${at(r.start_at)}.`,
        items,
        balance > 0 ? `Balance to pay: ${rupees(balance)}` : "",
        `Please bring your ID${r.rental_lines.some((l) => l.kind === "vehicle") ? " and driving licence" : ""}.`,
        contact,
      ].filter(Boolean).join("\n");
    case "return_reminder":
      return [
        `Hi ${name}, a reminder from *${ctx.shopName}*: booking *${r.token}* is due back ${at(r.end_at)}.`,
        items,
        `Late returns may be charged. Thank you!`,
        contact,
      ].filter(Boolean).join("\n");
    case "receipt":
      return [
        `Thank you, ${name}! Booking *${r.token}* with *${ctx.shopName}* is complete.`,
        `Total: ${rupees(r.total)} · Paid: ${rupees(r.paid)}${balance > 0 ? ` · Balance due: ${rupees(balance)}` : ""}`,
        Number(r.deposit_refunded) > 0 ? `Deposit returned: ${rupees(r.deposit_refunded)}` : "",
        Number(r.deposit_applied) > 0 ? `Deposit kept towards charges: ${rupees(r.deposit_applied)}` : "",
        `We hope to see you again.`,
      ].filter(Boolean).join("\n");
  }
}
