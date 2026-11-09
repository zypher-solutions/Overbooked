// Bulk add & edit: the rules behind the grid, the Excel/CSV import and the export (no React here, so it can be checked
// on its own: scripts/check-bulk.ts). One row is one variation (a colour/size) of a product; rows with the same SKU, or
// with the same category and name when the SKU is blank, become one product. Saving goes through import_catalog, which
// finds products and variations by SKU, so the same file both adds new products and updates existing ones.
import type { Category, Product, ShopAttribute } from "@/lib/shop/types";

export interface Field { key: string; label: string }
export interface Place { id: string; name: string }
export type ColKind = "text" | "attr" | "money" | "pieces";
export interface Col { key: string; label: string; kind: ColKind; required?: boolean; branchId?: string }
export interface Origin { productId: string; variationId: string; have: Record<string, number> }
export interface BulkRow { uid: string; cells: Record<string, string>; origin?: Origin }
export interface UnitLite { code: string; variation_id: string; branch_id: string; status: string }

// One spelling for attribute names and values, wherever they are typed (product form, Admin pages, bulk add):
// every word starts with a capital (royal blue -> Royal Blue, sleeve type -> Sleeve Type); the rest is kept as typed.
export const capitalWords = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, ch: string) => sp + ch.toUpperCase());
export const tidyName = (s: string) => capitalWords(s.trim().replace(/\s+/g, " "));
/** a value of an attribute: Size is all capitals (xl -> XL, 3xl -> 3XL), any other attribute starts each word with a capital */
export function tidyValue(value: string, attr: { key: string; label: string }): string {
  const v = value.trim().replace(/\s+/g, " ");
  return attr.key === "size" || attr.label.trim().toLowerCase() === "size" ? v.toUpperCase() : capitalWords(v);
}

/** categories named in the rows that the shop does not have yet, once each (any capitals), with a free base SKU each:
 *  the initials of the name (Outdoor Apparel -> OA), or its first letters for one word (Sarees -> SAR) */
export function missingCategories(rows: BulkRow[], categories: Pick<Category, "name" | "sku_prefix">[]): { name: string; sku_prefix: string }[] {
  const have = new Set(categories.map((c) => c.name.trim().toLowerCase()));
  const taken = new Set(categories.map((c) => c.sku_prefix).filter(Boolean));
  const out: { name: string; sku_prefix: string }[] = [];
  for (const r of rows) {
    const name = tidyName(r.cells.category ?? "");
    if (!name || name.length > 40 || have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    const words = name.toUpperCase().split(" ").map((w) => w.replace(/[^A-Z]/g, "")).filter(Boolean);
    const letters = words.join("");
    let base = (words.length > 1 ? words.map((w) => w[0]).join("") : letters.slice(0, 3)).slice(0, 4);
    if (base.length < 2) base = (letters + "CAT").slice(0, 3);
    // already used by another category: one more letter, from the name and then A to Z (letters only: OA -> OAP)
    const prefix = [base, ...[...letters.slice(base.length), ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((x) => base + x)].find((p) => !taken.has(p)) ?? base;
    taken.add(prefix);
    out.push({ name, sku_prefix: prefix });
  }
  return out;
}

export const skuPart =(s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);

/** the attribute keys a system-made variation SKU uses, in order (Admin > SKU); null = the shop has no attribute list yet */
export function skuKeys(attributes: Pick<ShopAttribute, "key" | "sku_position">[]): string[] {
  return attributes.filter((x) => x.sku_position !== null).sort((x, y) => x.sku_position! - y.sku_position!).map((x) => x.key);
}

/** the variation's part of a system-made SKU (BR-001-<this>): the shop's SKU attributes in their order, then any attribute the
 *  shop does not list at all (typed only on this product), so those never make two variations share a SKU */
export function variationSkuPart(a: Record<string, string>, attributes: Pick<ShopAttribute, "key" | "sku_position">[]): string {
  const known = new Set(attributes.map((x) => x.key));
  const keys = [...skuKeys(attributes), ...Object.keys(a).filter((k) => !known.has(k))];
  return skuPart(keys.map((k) => (a[k] ?? "").trim()).filter(Boolean).join("-"));
}

export const MONEY_KEYS = ["rate", "deposit", "mrp", "purchase", "replacement"] as const;

/** the grid's columns, in order; the branches give one "Pieces" column each */
export function bulkColumns(fields: Field[], branches: Place[]): Col[] {
  return [
    { key: "category", label: "Category", kind: "text", required: true },
    { key: "name", label: "Product name", kind: "text", required: true },
    { key: "sku", label: "SKU", kind: "text" },
    ...fields.map((f) => ({ key: `attr:${f.key}`, label: f.label, kind: "attr" as const })),
    { key: "rate", label: "Price per day", kind: "money", required: true },
    { key: "deposit", label: "Security deposit", kind: "money" },
    { key: "mrp", label: "MRP", kind: "money" },
    { key: "purchase", label: "Purchase price", kind: "money" },
    { key: "replacement", label: "Replacement value", kind: "money" },
    ...branches.map((b) => ({ key: `pieces:${b.id}`, label: branches.length > 1 ? `Pieces at ${b.name}` : "Pieces", kind: "pieces" as const, branchId: b.id })),
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string[]> = {
  category: ["category", "cat", "type"],
  name: ["productname", "name", "itemname", "product", "item"],
  sku: ["sku", "code", "itemsku", "productcode", "basesku", "productsku"],
  rate: ["priceperday", "rent", "rate", "price", "dailyrate", "rentperday"],
  deposit: ["securitydeposit", "deposit", "security", "securityamt", "securityamount"],
  mrp: ["mrp"],
  purchase: ["purchaseprice", "purchase", "costprice", "cost"],
  replacement: ["replacementvalue", "replacement"],
};

/** which column a header written by a person means: "Security Amt.", "Colour", "Qty", "Pieces at Main Branch" */
export function matchHeader(header: string, cols: Col[]): string | null {
  const h = norm(header);
  if (!h) return null;
  for (const c of cols) if (norm(c.label) === h) return c.key;
  for (const [key, names] of Object.entries(ALIASES)) if (names.includes(h)) return key;
  for (const c of cols) {
    if (c.kind === "attr" && (norm(c.key.slice(5)) === h || (h === "color" && c.key === "attr:colour") || (h === "colour" && c.key === "attr:color"))) return c.key;
  }
  const pieces = cols.filter((c) => c.kind === "pieces");
  if (["pieces", "qty", "quantity", "units", "stock"].includes(h) && pieces.length === 1) return pieces[0].key;
  // "Pieces at Main Branch", "Qty Main Branch" or just the branch's name
  for (const c of pieces) {
    const branch = norm(c.label.replace(/^Pieces at /, ""));
    if (h === branch || h.endsWith(branch)) return c.key;
  }
  return null;
}

/** text copied from Excel or Google Sheets: tab between cells, a new line between rows, quotes around a cell holding either */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** a money cell as typed or pasted: "₹1,500" -> "1500" */
export const cleanMoney = (v: string) => v.replace(/[₹,\s]|rs\.?/gi, "");

function cleanCell(col: Col | undefined, v: unknown): string {
  const s = String(v ?? "").trim();
  return col?.kind === "money" || col?.kind === "pieces" ? cleanMoney(s) : s;
}

/**
 * Rows from a pasted or imported table. When the first row is headers (two or more known names) every column goes
 * where its header says, whatever its position; otherwise the cells fill the grid's columns from `startKey` onwards,
 * as in Excel.
 */
export function rowsFromTable(table: string[][], cols: Col[], startKey = cols[0].key): { rows: Record<string, string>[]; unknownHeaders: string[]; headed: boolean } {
  if (!table.length) return { rows: [], unknownHeaders: [], headed: false };
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const mapped = table[0].map((h) => matchHeader(h, cols));
  const headed = mapped.filter(Boolean).length >= 2;
  const start = Math.max(0, cols.findIndex((c) => c.key === startKey));
  const keys = headed ? mapped : table[0].map((_, i) => cols[start + i]?.key ?? null);
  const body = headed ? table.slice(1) : table;
  const rows = body.map((r) => {
    const cells: Record<string, string> = {};
    r.forEach((v, i) => { const k = keys[i]; if (k) cells[k] = cleanCell(byKey.get(k), v); });
    return cells;
  }).filter((c) => Object.values(c).some((v) => v !== ""));
  return { rows, unknownHeaders: headed ? table[0].filter((h, i) => h.trim() && !mapped[i]) : [], headed };
}

// a clothing shop's product SKU (the database checks it too, migration 013): BR-001
const TYPED_SKU = /^[A-Z]{2,6}-[0-9]{3,4}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const sameAttrs = (a: Record<string, unknown>, b: Record<string, string>) => {
  const ka = Object.keys(a).filter((k) => String(a[k] ?? "").trim());
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && kb.every((k) => String(a[k] ?? "").trim().toLowerCase() === b[k].toLowerCase());
};

export interface ImportItem {
  category: string; name: string; sku: string;
  purchase_price: number; replacement_value: number; mrp: number; security_deposit: number;
  variations: { sku: string; name: string; attributes: Record<string, string>; rates: Record<string, string>; units: { branch: string; code: string }[] }[];
}
export interface PlanItem { sku: string; name: string; uids: string[]; isNew: boolean; item: ImportItem }
export interface Plan { errors: Record<string, string[]>; notes: Record<string, string>; items: PlanItem[] }
export interface PlanContext {
  cols: Col[]; categories: Category[]; products: Product[]; units: UnitLite[]; branches: Place[];
  /** the shop's SKU format (Admin > SKU); without it every attribute goes into the variation SKU, in column order */
  attributes?: Pick<ShopAttribute, "key" | "sku_position">[];
}

/** checks every row and groups the good ones into products ready for import_catalog; a product with a bad row is held back */
export function planRows(rows: BulkRow[], ctx: PlanContext): Plan {
  const errors: Record<string, string[]> = {};
  const notes: Record<string, string> = {};
  const err = (uid: string, msg: string) => { (errors[uid] ??= []).push(msg); };
  const attrCols = ctx.cols.filter((c) => c.kind === "attr");
  const pieceCols = ctx.cols.filter((c) => c.kind === "pieces");
  const bySku = new Map(ctx.products.map((p) => [p.sku.toUpperCase(), p]));
  const byName = new Map(ctx.products.map((p) => [`${p.category_id}|${p.name.trim().toLowerCase()}`, p]));
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const variationSkus = new Map<string, string>(); // variation SKU -> product id
  for (const p of ctx.products) for (const v of p.product_variations ?? []) variationSkus.set(v.sku.toUpperCase(), p.id);
  const codes = new Set(ctx.units.map((u) => u.code.toUpperCase()));
  const have = new Map<string, number>(); // variation:branch -> pieces not retired
  for (const u of ctx.units) if (u.status !== "retired") have.set(`${u.variation_id}:${u.branch_id}`, (have.get(`${u.variation_id}:${u.branch_id}`) ?? 0) + 1);
  // next number of each category's base SKU (BR-001, BR-002 ...), counting the ones handed out here too
  const highest = new Map<string, number>();
  for (const p of ctx.products) {
    const m = /^([A-Z]{2,6})-(\d+)$/.exec(p.sku);
    if (m) highest.set(m[1], Math.max(highest.get(m[1]) ?? 0, Number(m[2])));
  }
  const newSkuFor = new Map<string, string>(); // category|name -> SKU numbered here

  type Group = { sku: string; product?: Product; rows: BulkRow[]; cat: Category; attrs: Record<string, string>[] };
  const groups = new Map<string, Group>();

  for (const r of rows) {
    const c = r.cells;
    const cat = ctx.categories.find((x) => x.name.trim().toLowerCase() === (c.category ?? "").trim().toLowerCase());
    if (!(c.category ?? "").trim()) err(r.uid, "Choose a category.");
    else if (!cat) err(r.uid, `There is no category "${c.category.trim()}" yet. Press Save all to add it, or pick one from the list.`);
    const name = (c.name ?? "").trim();
    if (!name) err(r.uid, "Type the product name.");
    else if (name.length > 80) err(r.uid, "The product name is too long (80 characters at most).");
    for (const k of MONEY_KEYS) {
      const v = (c[k] ?? "").trim();
      const label = ctx.cols.find((x) => x.key === k)?.label ?? k;
      if (k === "rate" && !v) err(r.uid, "Type the price per day.");
      else if (v && !MONEY.test(v)) err(r.uid, `${label} must be a number like 600 or 599.50.`);
      else if (k === "rate" && Number(v) <= 0) err(r.uid, "The price per day must be more than zero.");
      else if (Number(v) > 10_000_000) err(r.uid, `${label} is too big.`);
    }
    if (Number(c.deposit) > 1_000_000) err(r.uid, "The security deposit cannot be more than ₹10,00,000.");
    for (const pc of pieceCols) {
      const v = (c[pc.key] ?? "").trim();
      if (v && (!/^\d+$/.test(v) || Number(v) > 2000)) err(r.uid, `${pc.label} must be a whole number from 0 to 2000.`);
    }
    if (!cat || !name) continue;

    // which product the row belongs to
    const typed = (c.sku ?? "").trim().toUpperCase();
    let product = r.origin ? byId.get(r.origin.productId) : undefined;
    let sku = product?.sku ?? "";
    if (typed && typed !== sku) {
      if (!TYPED_SKU.test(typed)) { err(r.uid, `SKU ${typed} is not allowed: use 2 to 6 letters, a hyphen, then 3 or 4 digits (e.g. LH-101). Or leave it blank to have it numbered for you.`); continue; }
      if (product) { err(r.uid, `A saved product keeps its SKU (${sku}). Clear the SKU cell to keep it.`); continue; }
      product = bySku.get(typed);
      sku = typed;
    }
    if (!sku) {
      product = byName.get(`${cat.id}|${name.toLowerCase()}`);
      sku = product?.sku ?? newSkuFor.get(`${cat.id}|${name.toLowerCase()}`) ?? "";
    }
    if (!sku) {
      if (!cat.sku_prefix) { err(r.uid, `Type a SKU, or give ${cat.name} a base SKU on the Categories page.`); continue; }
      const next = (highest.get(cat.sku_prefix) ?? 0) + 1;
      highest.set(cat.sku_prefix, next);
      sku = `${cat.sku_prefix}-${String(next).padStart(3, "0")}`;
      newSkuFor.set(`${cat.id}|${name.toLowerCase()}`, sku);
    }
    const g = groups.get(sku) ?? { sku, product, rows: [], cat, attrs: [] };
    g.rows.push(r);
    g.attrs.push(Object.fromEntries(attrCols.map((a) => [a.key.slice(5), tidyValue(c[a.key] ?? "", { key: a.key.slice(5), label: a.label })]).filter(([, v]) => v)));
    groups.set(sku, g);
  }

  const items: PlanItem[] = [];
  const usedCodes = new Set(codes);
  for (const g of groups.values()) {
    const first = g.rows[0].cells;
    // the product's own fields come from its first row; another row saying something else is a mistake to fix
    for (const r of g.rows.slice(1)) {
      for (const k of ["category", "name", "deposit", "mrp", "purchase", "replacement"]) {
        const a = (first[k] ?? "").trim().toLowerCase(); const b = (r.cells[k] ?? "").trim().toLowerCase();
        if (b && a !== b) err(r.uid, `This row is ${g.sku} too, but its ${ctx.cols.find((x) => x.key === k)?.label ?? k} differs from the first row of ${g.sku} (${first[k] || "blank"}).`);
      }
    }
    const seen = new Set<string>();
    const variations: ImportItem["variations"] = [];
    g.rows.forEach((r, i) => {
      const attrs = g.attrs[i];
      const key = JSON.stringify(Object.keys(attrs).sort().map((k) => [k, attrs[k].toLowerCase()]));
      if (seen.has(key)) { err(r.uid, `${g.sku} has this ${Object.values(attrs).join(" / ") || "variation"} twice.`); return; }
      seen.add(key);
      const saved = r.origin ? g.product?.product_variations?.find((v) => v.id === r.origin!.variationId)
        : g.product?.product_variations?.find((v) => sameAttrs(v.attributes ?? {}, attrs));
      const parts = ctx.attributes ? variationSkuPart(attrs, ctx.attributes) : skuPart(Object.values(attrs).join("-"));
      const vSku = saved?.sku ?? (parts ? `${g.sku}-${parts}` : g.sku);
      const owner = variationSkus.get(vSku.toUpperCase());
      if (!saved && owner && owner !== g.product?.id) { err(r.uid, `The variation SKU ${vSku} belongs to another product. Type a different SKU.`); return; }
      const units: { branch: string; code: string }[] = [];
      for (const pc of pieceCols) {
        const target = Math.floor(Number((r.cells[pc.key] ?? "").trim() || 0));
        const now = saved ? have.get(`${saved.id}:${pc.branchId}`) ?? 0 : 0;
        if ((r.cells[pc.key] ?? "").trim() === "") continue;
        if (target < now) { err(r.uid, `${pc.label}: it already has ${now} pieces. To remove pieces, retire them on the product's Pieces tab.`); continue; }
        const branch = ctx.branches.find((b) => b.id === pc.branchId)!;
        for (let n = 1, added = 0; added < target - now; n++) {
          const code = `${vSku}-${n}`.toUpperCase();
          if (usedCodes.has(code)) continue;
          usedCodes.add(code);
          units.push({ branch: branch.name, code });
          added++;
        }
      }
      variations.push({
        sku: vSku, name: saved?.name ?? (Object.values(attrs).join(" / ") || first.name.trim()), attributes: saved ? Object.fromEntries(Object.entries(saved.attributes ?? {}).map(([k, v]) => [k, String(v)])) : attrs,
        rates: { day: String(Number(r.cells.rate)) }, units,
      });
    });
    const uids = g.rows.map((r) => r.uid);
    for (const r of g.rows) notes[r.uid] = g.product ? `Updates ${g.sku}` : `New: ${g.sku}`;
    if (uids.some((u) => errors[u])) continue;
    items.push({
      sku: g.sku, name: first.name.trim(), uids, isNew: !g.product,
      item: {
        category: g.cat.name, name: first.name.trim(), sku: g.sku,
        purchase_price: Number(first.purchase || 0), replacement_value: Number(first.replacement || 0),
        mrp: Number(first.mrp || 0), security_deposit: Number(first.deposit || 0), variations,
      },
    });
  }
  return { errors, notes, items };
}

/** the grid rows (and export rows) of saved products: one per variation, with its pieces in each branch */
export function rowsOfProducts(products: Product[], ctx: { cols: Col[]; categories: Category[]; units: UnitLite[] }, uid: () => string): BulkRow[] {
  const count = new Map<string, number>();
  for (const u of ctx.units) if (u.status !== "retired") count.set(`${u.variation_id}:${u.branch_id}`, (count.get(`${u.variation_id}:${u.branch_id}`) ?? 0) + 1);
  const money = (n: unknown) => (Number(n) ? String(Number(n)) : "");
  return products.filter((p) => !p.is_set).flatMap((p) => (p.product_variations ?? []).filter((v) => v.is_enabled).map((v) => {
    const cells: Record<string, string> = {
      category: ctx.categories.find((c) => c.id === p.category_id)?.name ?? "", name: p.name, sku: p.sku,
      rate: money(v.variation_rates?.find((r) => r.rate_type === "day")?.amount), deposit: money(p.security_deposit), mrp: money(p.mrp),
      purchase: money(p.purchase_price), replacement: money(p.replacement_value),
    };
    const have: Record<string, number> = {};
    for (const c of ctx.cols) {
      if (c.kind === "attr") cells[c.key] = String(v.attributes?.[c.key.slice(5)] ?? "");
      if (c.kind === "pieces") { have[c.branchId!] = count.get(`${v.id}:${c.branchId}`) ?? 0; cells[c.key] = String(have[c.branchId!]); }
    }
    return { uid: uid(), cells, origin: { productId: p.id, variationId: v.id, have } };
  }));
}
