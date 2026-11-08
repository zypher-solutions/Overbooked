// Self-check of the bulk add & edit rules (src/modules/clothing/bulk.ts). No database needed:
//   node --experimental-strip-types scripts/check-bulk.ts
import assert from "node:assert/strict";
import { bulkColumns, matchHeader, parseTsv, planRows, rowsFromTable, rowsOfProducts, type BulkRow } from "../src/modules/clothing/bulk.ts";

const branches = [{ id: "b1", name: "Main" }, { id: "b2", name: "Kochi" }];
const cols = bulkColumns([{ key: "colour", label: "Colour" }, { key: "size", label: "Size" }], branches);
const categories = [{ id: "c1", name: "Bridal Lehenga", template_key: "bridal", sku_prefix: "BL" }, { id: "c2", name: "Sherwani", template_key: "groom", sku_prefix: null }];
const products = [{
  id: "p1", category_id: "c1", name: "Red Lehenga", sku: "BL-007", description: null, image_url: null, purchase_price: 20000, replacement_value: 0, is_set: false, is_active: true,
  product_variations: [{ id: "v1", product_id: "p1", name: "Red / M", sku: "BL-007-RED-M", attributes: { colour: "Red", size: "M" }, base_occupancy: null, max_occupancy: null, km_included_per_day: null, turnaround: "1 day", is_enabled: true, variation_rates: [{ rate_type: "day" as const, amount: 2500 }] }],
}];
const units = [{ code: "BL-007-RED-M-1", variation_id: "v1", branch_id: "b1", status: "available" }, { code: "BL-007-RED-M-2", variation_id: "v1", branch_id: "b1", status: "retired" }];
const ctx = { cols, categories, products, units, branches };
let n = 0;
const row = (cells: Record<string, string>, origin?: BulkRow["origin"]): BulkRow => ({ uid: `r${++n}`, cells, origin });

// headers people write
assert.equal(matchHeader("Security Amt.", cols), "deposit");
assert.equal(matchHeader("Color", cols), "attr:colour");
assert.equal(matchHeader("Pieces at Kochi", cols), "pieces:b2");
assert.equal(matchHeader("Rent", cols), "rate");
assert.equal(matchHeader("Whatever", cols), null);

// Excel paste: quoted cell with a tab and a new line; columns follow the headers, not their position (Rentopus shifted them)
const t = parseTsv('Name\tCategory\tRent\tSecurity Amt.\tQty Main\n"Gold\tset"\tbridal lehenga\t₹1,500\t500\t2\r\n');
assert.deepEqual(t[1], ["Gold\tset", "bridal lehenga", "₹1,500", "500", "2"]);
const fromHeaders = rowsFromTable(t, cols).rows[0];
assert.equal(fromHeaders.rate, "1500");
assert.equal(fromHeaders.deposit, "500");
assert.equal(fromHeaders["pieces:b1"], "2");
// no headers: cells fill from the column the paste started in
assert.deepEqual(rowsFromTable([["Blue", "L"]], cols, "attr:colour").rows[0], { "attr:colour": "Blue", "attr:size": "L" });

// a new product over two rows gets the next category number and two variations with piece codes
const plan = planRows([
  row({ category: "bridal lehenga", name: "Pink Lehenga", "attr:colour": "Pink", "attr:size": "S", rate: "3000", deposit: "1000", "pieces:b1": "2" }),
  row({ category: "Bridal Lehenga", name: "pink lehenga", "attr:colour": "Pink", "attr:size": "M", rate: "3000", "pieces:b2": "1" }),
], ctx);
assert.deepEqual(plan.errors, {});
assert.equal(plan.items.length, 1);
assert.equal(plan.items[0].sku, "BL-008");
assert.equal(plan.items[0].item.security_deposit, 1000);
assert.deepEqual(plan.items[0].item.variations.map((v) => v.sku), ["BL-008-PINK-S", "BL-008-PINK-M"]);
assert.deepEqual(plan.items[0].item.variations[0].units, [{ branch: "Main", code: "BL-008-PINK-S-1" }, { branch: "Main", code: "BL-008-PINK-S-2" }]);

// a saved product: found by its SKU, its variation by colour and size; new pieces skip codes already used (even retired ones)
const upd = planRows([row({ category: "Bridal Lehenga", name: "Red Lehenga", sku: "bl-007", "attr:colour": "red", "attr:size": "M", rate: "2800", "pieces:b1": "3" })], ctx);
assert.deepEqual(upd.errors, {});
assert.equal(upd.items[0].isNew, false);
assert.equal(upd.items[0].item.variations[0].sku, "BL-007-RED-M");
assert.deepEqual(upd.items[0].item.variations[0].units.map((u) => u.code), ["BL-007-RED-M-3", "BL-007-RED-M-4"]);

// mistakes are reported on their row and hold back only their product
// a clothing SKU must look like BR-001 (the database refuses anything else)
const typedBad = row({ category: "Bridal Lehenga", name: "Typed", sku: "ZTEST-CL", rate: "100" });
assert.match(planRows([typedBad], ctx).errors[typedBad.uid][0], /e\.g\. LH-101/);
const typedGood = row({ category: "Bridal Lehenga", name: "Typed", sku: "lh-101", rate: "100" });
assert.equal(planRows([typedGood], ctx).items[0].sku, "LH-101");

const [unknown, noPrefix, wrong] = [
  row({ category: "Gowns", name: "X", rate: "100" }),
  row({ category: "Sherwani", name: "No SKU", rate: "100" }),
  row({ category: "Bridal Lehenga", name: "Red Lehenga", "attr:colour": "Red", "attr:size": "M", rate: "abc", "pieces:b1": "0" }),
];
const bad = planRows([unknown, noPrefix, wrong, row({ category: "Bridal Lehenga", name: "Fine", rate: "100" })], ctx);
assert.match(bad.errors[unknown.uid][0], /no category "Gowns"/);
assert.match(bad.errors[noPrefix.uid][0], /give Sherwani a base SKU/);
assert.ok(bad.errors[wrong.uid].some((e) => /number like 600/.test(e)));
assert.ok(bad.errors[wrong.uid].some((e) => /already has 1 pieces/.test(e)));
assert.deepEqual(bad.items.map((i) => i.name), ["Fine"]);

// loading saved products gives one row per variation with its pieces per branch
const loaded = rowsOfProducts(products, { cols, categories, units }, () => "x");
assert.equal(loaded[0].cells["pieces:b1"], "1");
assert.equal(loaded[0].cells.rate, "2500");
assert.equal(loaded[0].cells["attr:colour"], "Red");

console.log("bulk.ts: all checks passed");
