// Screen-load test against the LOCAL Supabase only, as a signed-in shop owner (security rules on).
// Usage: node load-test.mjs <project-dir>. Reads the local URL and anon key from `supabase status`; never prints them.
import { execSync } from "node:child_process";

const dir = process.argv[2];
const status = JSON.parse(execSync("npx supabase status -o json", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString());
const URL_ = status.API_URL;
const ANON = status.ANON_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_)) throw new Error("Not the local Supabase; refusing to run.");

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "owner@bridal.test", password: "Overbooked-Demo-2026!" }),
}).then((r) => r.json());
const H = { apikey: ANON, Authorization: `Bearer ${login.access_token}`, "Content-Type": "application/json" };

let bytes = 0;
async function get(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${t.slice(0, 200)}`);
  bytes += t.length;
  return JSON.parse(t);
}
async function rpc(fn, body) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${fn}: ${t.slice(0, 200)}`);
  bytes += t.length;
  return JSON.parse(t);
}

const now = new Date();
const iso = (d) => encodeURIComponent(d.toISOString());
const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
const tomorrow = new Date(dayStart.getTime() + 86400000);
const week = new Date(dayStart.getTime() + 8 * 86400000);
const LIST = "id,token,status,start_at,end_at,total,paid,branch_id,created_at,customers!rentals_shop_customer_fkey(id,full_name,phone),rental_lines(description,qty,kind)";
const anyRental = (await get("rentals?select=id&status=eq.completed&order=actual_end_at.desc&limit=1"))[0].id;

const screens = {
  today: async () => Promise.all([
    get(`rentals?select=${LIST}&status=eq.reserved&start_at=lt.${iso(tomorrow)}&order=start_at`),
    get(`rentals?select=${LIST}&status=eq.active&end_at=lt.${iso(tomorrow)}&order=end_at`),
    get(`rentals?select=${LIST}&status=eq.reserved&start_at=gte.${iso(tomorrow)}&start_at=lt.${iso(week)}&order=start_at&limit=50`),
    get(`rentals?select=id&status=eq.active`),
  ]),
  bookings: async () => {
    const rows = await get(`rentals?select=id,token,status,start_at,end_at,total,paid,branch_id,created_at,customer_id&status=eq.completed&order=actual_end_at.desc&offset=0&limit=50`);
    const ids = rows.map((r) => r.id).join(",");
    const cids = Array.from(new Set(rows.map((r) => r.customer_id))).join(",");
    return Promise.all([get(`customers?select=id,full_name,phone&id=in.(${cids})`), get(`rental_lines?select=rental_id,description,qty,kind&rental_id=in.(${ids})`)]);
  },
  booking: async () => Promise.all([
    get(`rentals?select=*,customers!rentals_shop_customer_fkey(*),rental_lines(*),rental_add_ons(*),rental_charges(*),rental_checks(*),unit_reservations(*,units!unit_reservations_shop_unit_fkey(id,code,odometer,status,status_reason,variation_id))&id=eq.${anyRental}`),
    get(`payments?select=*&rental_id=eq.${anyRental}&order=paid_at`),
  ]),
  catalog: async () => Promise.all([
    get(`products?select=*,product_variations!product_variations_shop_product_fkey(*,variation_rates!variation_rates_shop_variation_fkey(rate_type,amount))&order=name&offset=0&limit=500`),
    get(`units?select=variation_id,branch_id,status&offset=0&limit=1000`),
  ]),
  money: async () => {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    return Promise.all([
      rpc("dashboard_summary", { p_from: from, p_to: to, p_branch_id: null }),
      rpc("inventory_status", {}),
      get(`payments?select=*,rentals!payments_shop_rental_fkey!inner(token,branch_id,customers!rentals_shop_customer_fkey(full_name))&paid_at=gte.${iso(new Date(from))}&order=paid_at.desc&offset=0&limit=300`),
    ]);
  },
  calendar: async () => Promise.all([
    get(`units?select=*&branch_id=eq.b0000000-0000-0000-0000-000000000001&status=neq.retired&order=code`),
    get(`unit_reservations?select=id,unit_id,period,state,rental_id,rentals!unit_reservations_shop_rental_fkey(token,status,end_at,actual_end_at,customers!rentals_shop_customer_fkey(full_name))&state=neq.released&period=ov.${encodeURIComponent(`[${dayStart.toISOString()},${week.toISOString()})`)}`),
  ]),
};

// warm up, then each screen alone, then a mixed run with 5 people at once
for (const s of Object.values(screens)) await s();
const results = {};
for (const [name, s] of Object.entries(screens)) {
  bytes = 0;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) await s();
  results[name] = { ms: Math.round((performance.now() - t0) / 20), kb: Math.round(bytes / 20 / 1024) };
}
bytes = 0;
const names = Object.keys(screens);
const t0 = performance.now();
let done = 0;
await Promise.all(Array.from({ length: 5 }, async (_, w) => {
  for (let i = 0; i < 40; i++) { await screens[names[(i + w) % names.length]](); done++; }
}));
const secs = (performance.now() - t0) / 1000;
console.log(JSON.stringify({ per_screen: results, mixed: { screens: done, per_second: +(done / secs).toFixed(1), avg_kb: Math.round(bytes / done / 1024) } }, null, 2));
