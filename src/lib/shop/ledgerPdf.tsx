// The Finance "Export PDF": the listed records with totals, as in TRENDZ. The PDF library loads only when
// the button is pressed, so it stays out of the normal pages.
export interface LedgerPdfRow {
  token: string; customer: string; phone: string; item: string; branch: string;
  start: string; due: string; total: number; paid: number; balance: number; status: string; late: boolean; cancelled: boolean; fee: number;
}

const pdfInr = (n: number) => `Rs. ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const C = {
  gold: "#C89B3C", goldLight: "#F5EDD4", black: "#1A1A1A", dark: "#2C2C2C", gray: "#6B7280", grayLight: "#F3F4F6", white: "#FFFFFF",
  green: "#15803D", red: "#B91C1C", blue: "#1D4ED8", border: "#E5E7EB", rowAlt: "#FAFAFA",
};

export async function generateLedgerPDF(shopName: string, rows: LedgerPdfRow[], filters: string[]) {
  const { Document, Page, Text, View, StyleSheet, pdf } = await import("@react-pdf/renderer");
  const React = await import("react");
  const h = React.createElement;

  const s = StyleSheet.create({
    page: { backgroundColor: C.white, paddingTop: 24, paddingBottom: 28, paddingHorizontal: 24, fontFamily: "Helvetica", fontSize: 8, color: C.dark },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2.5, borderBottomColor: C.gold, paddingBottom: 10, marginBottom: 14 },
    brand: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.gold },
    title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C.black, textAlign: "right", textTransform: "uppercase" },
    meta: { fontSize: 7, color: C.gray, textAlign: "right", marginTop: 3 },
    cards: { flexDirection: "row", marginBottom: 14 },
    card: { flex: 1, borderRadius: 5, borderWidth: 1, borderColor: C.border, backgroundColor: C.grayLight, paddingHorizontal: 10, paddingVertical: 7, marginRight: 8 },
    cardLabel: { fontSize: 6.5, color: C.gray, textTransform: "uppercase", marginBottom: 3 },
    cardValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.black },
    box: { borderRadius: 4, borderWidth: 1, borderColor: C.border },
    head: { flexDirection: "row", backgroundColor: C.black, paddingVertical: 6, paddingHorizontal: 4 },
    th: { fontFamily: "Helvetica-Bold", fontSize: 7, color: C.gold, textTransform: "uppercase", paddingHorizontal: 4 },
    row: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: C.border },
    td: { fontSize: 7.5, color: C.dark, paddingHorizontal: 4 },
    sub: { fontSize: 6, color: C.gray, marginTop: 1.5, paddingHorizontal: 4 },
    totals: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 4, backgroundColor: C.goldLight, borderTopWidth: 1.5, borderTopColor: C.gold },
    footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: C.border },
    foot: { fontSize: 7, color: C.gray },
    right: { textAlign: "right" },
    bold: { fontFamily: "Helvetica-Bold" },
  });
  const W = { token: "12%", cust: "16%", item: "15%", branch: "8%", start: "8%", due: "8%", total: "9%", paid: "9%", bal: "9%", status: "10%" };
  const cell = (w: string, ...children: unknown[]) => h(View, { style: { width: w, paddingRight: 4 } }, ...(children as never[]));

  const value = rows.reduce((a, r) => a + (r.cancelled ? r.fee : r.total), 0);
  const paid = rows.reduce((a, r) => a + r.paid, 0);
  const balance = rows.reduce((a, r) => a + r.balance, 0);
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date());

  const card = (label: string, v: string | number) => h(View, { style: s.card }, h(Text, { style: s.cardLabel }, label), h(Text, { style: s.cardValue }, String(v)));
  const doc = h(Document, { title: `${shopName} Financial Ledger`, author: shopName },
    h(Page, { size: "A4", style: s.page, wrap: true },
      h(View, { style: s.header, fixed: true },
        h(View, null, h(Text, { style: s.brand }, shopName)),
        h(View, null, h(Text, { style: s.title }, "Financial Ledger"), h(Text, { style: s.meta }, `Generated on ${when}`),
          filters.length ? h(Text, { style: s.meta }, filters.join("  |  ")) : null)),
      h(View, { style: s.cards }, card("Total records", rows.length), card("Value of listed records", pdfInr(value)),
        card("Paid on listed records", pdfInr(paid)), card("Balance on listed records", pdfInr(balance))),
      h(View, { style: s.box },
        h(View, { style: s.head, fixed: true },
          ...([["Token", W.token], ["Customer", W.cust], ["Item", W.item], ["Branch", W.branch], ["Rent date", W.start], ["Due date", W.due]] as const)
            .map(([t, w]) => h(Text, { key: t, style: [s.th, { width: w }] }, t)),
          ...([["Total", W.total], ["Paid", W.paid], ["Balance", W.bal]] as const).map(([t, w]) => h(Text, { key: t, style: [s.th, s.right, { width: w }] }, t)),
          h(Text, { style: [s.th, { width: W.status }] }, "Status")),
        rows.length === 0
          ? h(View, { style: { padding: 20, alignItems: "center" } }, h(Text, { style: { fontSize: 9, color: C.gray } }, "No records found for the selected filters."))
          : rows.map((r, i) => h(View, { key: i, style: [s.row, r.late ? { backgroundColor: "#FFF7F7" } : i % 2 ? { backgroundColor: C.rowAlt } : {}], wrap: false },
            cell(W.token, h(Text, { style: [s.td, s.bold] }, r.token)),
            cell(W.cust, h(Text, { style: [s.td, s.bold] }, r.customer || "-"), r.phone ? h(Text, { style: s.sub }, r.phone) : null),
            cell(W.item, h(Text, { style: s.td }, r.item)),
            cell(W.branch, h(Text, { style: s.td }, r.branch || "-")),
            cell(W.start, h(Text, { style: s.td }, r.start)),
            cell(W.due, h(Text, { style: [s.td, r.late ? { color: C.red } : {}] }, r.due)),
            cell(W.total, h(Text, { style: [s.td, s.right] }, pdfInr(r.cancelled ? r.fee : r.total)), r.cancelled ? h(Text, { style: [s.sub, s.right] }, `Orig: ${pdfInr(r.total)}`) : null),
            cell(W.paid, h(Text, { style: [s.td, s.right, { color: C.green }] }, pdfInr(r.paid))),
            cell(W.bal, h(Text, { style: [s.td, s.right, { color: r.balance > 0 ? C.red : C.green }] }, pdfInr(r.balance))),
            h(View, { style: { width: W.status } }, h(Text, { style: [s.td, s.bold, { color: r.late ? C.red : C.dark }] }, r.status)))),
        h(View, { style: s.totals },
          h(Text, { style: [s.td, s.bold, { width: "60%" }] }, "TOTALS"),
          h(Text, { style: [s.td, s.bold, s.right, { width: W.total }] }, pdfInr(value)),
          h(Text, { style: [s.td, s.bold, s.right, { width: W.paid, color: C.green }] }, pdfInr(paid)),
          h(Text, { style: [s.td, s.bold, s.right, { width: W.bal, color: C.red }] }, pdfInr(balance)),
          h(Text, { style: { width: W.status } }, ""))),
      h(View, { style: s.footer, fixed: true },
        h(Text, { style: s.foot }, `${shopName} - Confidential`),
        h(Text, { style: s.foot, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` }))));

  const blob = await pdf(doc as never).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Ledger-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
