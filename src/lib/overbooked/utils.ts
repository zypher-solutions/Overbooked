import type { PaymentStatus, Rental } from "./types";
import { shopBrand } from "./brand";

/** Whole rupees stay whole; paise are shown when present so displayed parts add up to the total. */
export const inr = (n: number) => {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export const todayISO = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(new Date());
};

export const shiftISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(d);
};

/** YYYY-MM-DD -> DD/MM/YYYY */
export const fmtDate = (iso: string) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

export const daysBetween = (fromISO: string, toISO: string) => {
  const a = new Date(fromISO + "T00:00:00").getTime();
  const b = new Date(toISO + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
};

export const isOverdue = (r: any) => {
  const dueDate = r.dueDate || r.items?.[0]?.returnDate;
  return (r.status === "out" || r.status === "confirmed") && dueDate && dueDate < todayISO();
};

export const balanceOf = (r: any) => {
  if (r.status === "cancelled") return 0;
  // `total` already includes any return fees; extra_fees is only a breakdown
  return Math.max(0, (r.total || 0) - (r.advance || 0));
};

export const paymentLabel = (p: PaymentStatus) =>
  p === "paid" ? "Paid" : p === "partial" ? "Partial" : "Unpaid";

export const digitsOnly = (s: string) => s.replace(/\D/g, "");

export const waMessage = (r: any) => {
  const rentDate = r.rentDate || r.items?.[0]?.pickupDate || "N/A";
  const dueDate = r.dueDate || r.items?.[0]?.returnDate || "N/A";
  const branch = r.branchName || r.branch || "N/A";
  const sku = r.items?.length === 1 ? (r.items[0].sku || r.items[0].itemSku || "Unknown SKU") : "Multiple SKUs";

  return [
    `✨ *Rental Confirmed!* ✨`,
    `Hi ${r.customerName}, thank you for choosing *${shopBrand()}*!`,
    ``,
    `👔 *Item:* ${r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`} (${sku})`,
    `📅 *Rented On:* ${fmtDate(rentDate)}`,
    `⏰ *Due Back:* ${fmtDate(dueDate)}`,
    ``,
    `💰 *Financials:*`,
    `• Total: ${inr(r.total)}`,
    `• Advance Paid: ${inr(r.advance)}`,
    r.securityDeposit ? `• Security Deposit: ${inr(r.securityDeposit)}` : ``,
    balanceOf(r) > 0 
      ? `• Pending Balance: ${inr(balanceOf(r))}` 
      : `• Pending Balance: ₹0 (Fully Paid)`,
    ``,
    `📌 *Token ID:* ${r.token}`,
    `📍 *Branch:* ${branch}`,
    ``,
    `We hope you have a great event! Please ensure the item is returned on time to avoid late fees.`,
  ].join("\n");
};

export const waReminder = (r: any) => {
  const dueDate = r.dueDate || r.items?.[0]?.returnDate || "N/A";
  const branch = r.branchName || r.branch || "N/A";

  if (r.status === "returned" || r.status === "completed") {
    return [
      `🎉 *Thank You from ${shopBrand()}!* 🎉`,
      `Hi ${r.customerName},`,
      ``,
      `We have successfully received the *${r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}* (Token: ${r.token}).`,
      ``,
      `Thank you so much for choosing ${shopBrand()} for your event! We hope you loved it and look forward to serving you again. ✨`,
    ].join("\n");
  }

  return [
    isOverdue(r) ? `⚠️ *OVERDUE RENTAL ALERT* ⚠️` : `🔔 *Friendly Reminder from ${shopBrand()}!* 🔔`,
    `Hi ${r.customerName},`,
    ``,
    isOverdue(r)
      ? `Your rental for the *${r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}* was due back on *${fmtDate(dueDate)}* and is currently overdue.`
      : `Just a quick reminder that your rental for the *${r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}* is due back on *${fmtDate(dueDate)}*.`,
    ``,
    `📌 *Token ID:* ${r.token}`,
    balanceOf(r) > 0 
      ? `💰 *Pending Balance:* ${inr(balanceOf(r))}` 
      : `💰 *Pending Balance:* ₹0 (Fully Paid)`,
    ``,
    isOverdue(r)
      ? `Please return the item at the earliest. Note that late fees may apply for each additional day.`
      : `We hope you enjoyed using it! Please return it to our *${branch}* branch on time.`,
    ``,
    `Thank you! ✨`,
  ].join("\n");
};

export const waPhone = (phone: string) => {
  const d = digitsOnly(phone);
  return d.length > 10 ? d : "91" + d;
};

export const waLink = (phone: string, text: string, app = false) => {
  const base = app
    ? "whatsapp://send?"
    : "https://api.whatsapp.com/send/?";
  return `${base}phone=${waPhone(phone)}&text=${encodeURIComponent(text)}`;
};

export const downloadCSV = (filename: string, rows: (string | number)[][]) => {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export function formatProductPrice(
  product: { dailyRate?: number; variations?: { dailyRate?: number }[] } | null | undefined
): string {
  if (!product) return "₹0";
  const rates = (product.variations || [])
    .map((v) => Number(v.dailyRate || 0))
    .filter((r) => r > 0);

  if (rates.length === 0) {
    return inr(product.dailyRate || 0);
  }

  const min = Math.min(...rates);
  const max = Math.max(...rates);

  if (min === max) {
    return inr(min);
  }

  return `${inr(min)} – ${inr(max)}`;
}

export const validateCategoryBaseSku = (sku: string) => {
  return /^[A-Z]{2,6}$/.test(sku);
};

export const validateProductSku = (sku: string) => {
  return /^[A-Z]{2,6}-\d{3,4}(-[A-Za-z0-9]+)*$/.test(sku);
};

