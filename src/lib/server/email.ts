// Emails the app sends itself (Supabase sends only its own sign-in emails). Resend's HTTP API, no package.
// Needs RESEND_API_KEY (a sending-only key) and EMAIL_FROM ("Overbooked <no-reply@your-domain>") on the server.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// the same green card as the Supabase templates (docs/SETUP.md)
function card(title: string, paragraphs: string[], warning: string) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4b5956;">${t}</p>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f6;padding:32px 16px;font-family:'DM Sans',Arial,Helvetica,sans-serif;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 8px 20px;font-size:20px;font-weight:700;color:#0f4743;">Overbooked</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e3e8e6;border-radius:20px;padding:32px 28px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#101715;">${title}</h1>${p}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr>
<td style="background:#fdf3ee;border:1px solid #f1d5c6;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.6;color:#7a2e12;">${warning}</td>
</tr></table></td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:#6b7774;">This is an automatic security notice. You can't reply to it.</td></tr>
</table></td></tr></table>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("Email is not set up on the server (RESEND_API_KEY and EMAIL_FROM).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error("Could not send the email: " + (await res.text()).slice(0, 200));
}

// migration 051: Zypher confirmed a master password reset; the owner can still cancel during the wait
export async function sendMasterResetAlert(to: string, shop: string, readyAt: string, settingsUrl: string) {
  const when = new Date(readyAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  await sendEmail(to, "Your Overbooked master password will be reset", card(
    "Master password reset requested",
    [
      `Someone asked Zypher to reset the master password of <strong style="color:#101715;">${esc(shop)}</strong>, and Zypher confirmed it by phone.`,
      `It unlocks on <strong style="color:#101715;">${esc(when)}</strong> (India time). After that, the owner can set a new master password.`,
    ],
    `<strong>Wasn't you?</strong> Sign in and press <strong>Cancel</strong> under Settings → Master password before then: <a href="${esc(settingsUrl)}" style="color:#7a2e12;">${esc(settingsUrl)}</a>. Then call Zypher support.`,
  ));
}
