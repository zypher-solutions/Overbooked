"use client";

import React from "react";
import { shopBrand } from "./brand";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { Rental } from "@/lib/overbooked/types";
import { balanceOf, isOverdue } from "@/lib/overbooked/utils";
import { format } from "date-fns";

// ── Helpers ───────────────────────────────────────────────────────────────
const pdfInr = (n: number) =>
  `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

const fmtDate = (d: string) => {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
  return d;
};

// ── Colors ────────────────────────────────────────────────────────────────
const C = {
  gold: "#C89B3C",
  goldLight: "#F5EDD4",
  black: "#1A1A1A",
  dark: "#2C2C2C",
  gray: "#6B7280",
  grayLight: "#F3F4F6",
  white: "#FFFFFF",
  green: "#15803D",
  greenLight: "#DCFCE7",
  red: "#B91C1C",
  redLight: "#FEE2E2",
  blue: "#1D4ED8",
  blueLight: "#DBEAFE",
  border: "#E5E7EB",
  rowAlt: "#FAFAFA",
};

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    backgroundColor: C.white,
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 24,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: C.dark,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2.5,
    borderBottomColor: C.gold,
    paddingBottom: 10,
    marginBottom: 14,
  },
  brandName: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: C.gold,
    letterSpacing: -0.5,
  },
  brandSub: {
    fontSize: 7,
    color: C.gray,
    letterSpacing: 1.5,
    marginTop: 2,
    textTransform: "uppercase",
  },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: C.black,
    textAlign: "right",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  docMeta: {
    fontSize: 7,
    color: C.gray,
    textAlign: "right",
    marginTop: 3,
  },
  filterBadge: {
    backgroundColor: C.goldLight,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  filterBadgeText: {
    fontSize: 6.5,
    color: "#7C5C10",
  },

  // Summary cards
  summaryRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  card: {
    flex: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.grayLight,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  cardGold: { borderLeftWidth: 3, borderLeftColor: C.gold },
  cardGreen: { borderLeftWidth: 3, borderLeftColor: C.green },
  cardRed: { borderLeftWidth: 3, borderLeftColor: C.red },
  cardBlue: { borderLeftWidth: 3, borderLeftColor: C.blue },
  cardLabel: {
    fontSize: 6.5,
    color: C.gray,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  cardValue: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: C.black,
  },

  // Table
  tableContainer: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C.black,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  thText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: C.gold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  tableRowAlt: { backgroundColor: C.rowAlt },
  tableRowOverdue: { backgroundColor: "#FFF7F7" },
  tdText: { fontSize: 7.5, color: C.dark, paddingHorizontal: 4 },
  tdMono: { fontSize: 7, fontFamily: "Helvetica", color: C.dark, paddingHorizontal: 4 },
  tdSubtext: { fontSize: 6, color: C.gray, marginTop: 1.5, paddingHorizontal: 4 },

  // Totals row
  totalsRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: C.goldLight,
    borderTopWidth: 1.5,
    borderTopColor: C.gold,
  },
  totalsLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: "#7C5C10",
    letterSpacing: 0.5,
  },
  totalsValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: C.black,
    textAlign: "right",
  },

  // Footer
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
  },
  footerText: { fontSize: 7, color: C.gray },

  colToken: { width: "13%", paddingRight: 6 },
  colCust: { width: "16%", paddingRight: 6 },
  colItem: { width: "14%", paddingRight: 6 },
  colBranch: { width: "7%", paddingRight: 6 },
  colRdate: { width: "8%", paddingRight: 6 },
  colDdate: { width: "8%", paddingRight: 6 },
  colTotal: { width: "8%", paddingRight: 6 },
  colAdv: { width: "8%", paddingRight: 6 },
  colBal: { width: "8%", paddingRight: 6 },
  colStatus: { width: "10%", paddingLeft: 6 },
  right: { textAlign: "right" },
});

// ── Document ──────────────────────────────────────────────────────────────
interface LedgerDocProps {
  rows: Rental[];
  filters?: { branch?: string; from?: string; to?: string; status?: string };
}

export function LedgerDocument({ rows, filters }: LedgerDocProps) {
  const now = format(new Date(), "dd MMM yyyy, hh:mm a");
  const totalRevenue = rows.reduce((a, r) => {
    if (r.status === "cancelled") {
      return a + (r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0);
    }
    return a + (r.total || 0);
  }, 0);

  const totalAdvanceCol = rows.reduce((a, r) => {
    if (r.status === "cancelled") {
      return a + (r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0);
    }
    return a + (r.advance || 0);
  }, 0);

  const totalCollected = rows.reduce((a, r) => {
    if (r.status === "cancelled") {
      return a + (r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0);
    }
    return a + (r.advance || 0);
  }, 0);

  const totalBalance = rows.reduce((a, r) => a + balanceOf(r), 0);

  const filterParts: string[] = [];
  if (filters?.branch && filters.branch !== "all") filterParts.push(`Branch: ${filters.branch}`);
  if (filters?.from) filterParts.push(`From: ${fmtDate(filters.from)}`);
  if (filters?.to) filterParts.push(`To: ${fmtDate(filters.to)}`);
  if (filters?.status && filters.status !== "all") filterParts.push(`Status: ${filters.status.toUpperCase()}`);

  return (
    <Document title={`${shopBrand()} Financial Ledger`} author={shopBrand()}>
      <Page size="A4" style={s.page} wrap>
        {/* ── HEADER ── */}
        <View style={s.header} fixed>
          <View>
            <Text style={s.brandName}>{shopBrand()}</Text>
            <Text style={s.brandSub}>Powered by Overbooked</Text>
          </View>
          <View>
            <Text style={s.docTitle}>Financial Ledger</Text>
            <Text style={s.docMeta}>Generated on {now}</Text>
            {filterParts.length > 0 && (
              <View style={s.filterBadge}>
                <Text style={s.filterBadgeText}>{filterParts.join("  |  ")}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── SUMMARY CARDS ── */}
        <View style={s.summaryRow}>
          <View style={[s.card, s.cardBlue]}>
            <Text style={s.cardLabel}>Total Records</Text>
            <Text style={s.cardValue}>{rows.length}</Text>
          </View>
          <View style={[s.card, s.cardGold]}>
            <Text style={s.cardLabel}>Total Revenue</Text>
            <Text style={s.cardValue}>{pdfInr(totalRevenue)}</Text>
          </View>
          <View style={[s.card, s.cardGreen]}>
            <Text style={s.cardLabel}>Total Collected</Text>
            <Text style={s.cardValue}>{pdfInr(totalCollected)}</Text>
          </View>
          <View style={[s.card, s.cardRed]}>
            <Text style={s.cardLabel}>Outstanding Balance</Text>
            <Text style={s.cardValue}>{pdfInr(totalBalance)}</Text>
          </View>
        </View>

        {/* ── TABLE ── */}
        <View style={s.tableContainer}>
          {/* Head */}
          <View style={s.tableHead} fixed>
            <Text style={[s.thText, s.colToken]}>Token</Text>
            <Text style={[s.thText, s.colCust]}>Customer</Text>
            <Text style={[s.thText, s.colItem]}>Item</Text>
            <Text style={[s.thText, s.colBranch]}>Branch</Text>
            <Text style={[s.thText, s.colRdate]}>Rent Date</Text>
            <Text style={[s.thText, s.colDdate]}>Due Date</Text>
            <Text style={[s.thText, s.colTotal, s.right]}>Total</Text>
            <Text style={[s.thText, s.colAdv, s.right]}>Advance</Text>
            <Text style={[s.thText, s.colBal, s.right]}>Balance</Text>
            <Text style={[s.thText, s.colStatus]}>Status</Text>
          </View>

          {/* Rows */}
          {rows.length === 0 ? (
            <View style={{ padding: 20, alignItems: "center" }}>
              <Text style={{ fontSize: 9, color: C.gray, fontStyle: "italic" }}>
                No records found for the selected filters.
              </Text>
            </View>
          ) : (
            rows.map((r, i) => {
              const overdue = isOverdue(r);
              const bal = balanceOf(r);
              const rowStyle = overdue
                ? s.tableRowOverdue
                : i % 2 !== 0
                ? s.tableRowAlt
                : {};
              const statusColor = overdue ? C.red : r.status === "returned" ? C.green : C.dark;
              const statusLabel = r.status.toUpperCase() + (overdue ? " ⚠" : "");

              return (
                <View key={r.id} style={[s.tableRow, rowStyle]} wrap={false}>
                  <View style={s.colToken}>
                    <Text style={[s.tdText, { fontFamily: "Helvetica-Bold", color: C.black }]}>
                      {r.token || "—"}
                    </Text>
                  </View>
                  <View style={s.colCust}>
                    <Text style={[s.tdText, { fontFamily: "Helvetica-Bold" }]}>
                      {r.customerName || "—"}
                    </Text>
                    {r.customerPhone ? (
                      <Text style={s.tdSubtext}>{r.customerPhone}</Text>
                    ) : null}
                  </View>
                  <View style={s.colItem}>
                    <Text style={s.tdText}>{r.items?.length === 1 ? r.items[0].productName : `${r.items?.length || 0} items`}</Text>
                    {r.items?.length === 1 && r.items[0].variationName ? (
                      <Text style={s.tdSubtext}>{r.items[0].variationName}</Text>
                    ) : null}
                  </View>
                  <View style={s.colBranch}>
                    <Text style={s.tdText}>{r.branch || "—"}</Text>
                  </View>
                  <View style={s.colRdate}>
                    <Text style={s.tdMono}>{fmtDate(r.rentDate)}</Text>
                  </View>
                  <View style={s.colDdate}>
                    <Text style={[s.tdMono, overdue ? { color: C.red, fontFamily: "Helvetica-Bold" } : {}]}>
                      {fmtDate(r.dueDate)}
                    </Text>
                  </View>
                  <View style={s.colTotal}>
                    <Text style={[s.tdMono, s.right]}>
                      {r.status === "cancelled"
                        ? pdfInr(r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0)
                        : pdfInr(r.total || 0)}
                    </Text>
                    {r.status === "cancelled" ? (
                      <Text style={[s.tdSubtext, s.right]}>Orig: {pdfInr(r.total || 0)}</Text>
                    ) : null}
                  </View>
                  <View style={s.colAdv}>
                    <Text style={[s.tdMono, s.right, { color: C.green }]}>
                      {r.status === "cancelled"
                        ? pdfInr(r.cancellationFee ?? r.bookingRef?.cancellationFee ?? 0)
                        : pdfInr(r.advance || 0)}
                    </Text>
                    {r.status === "cancelled" ? (
                      <Text style={[s.tdSubtext, s.right, { color: C.gray }]}>
                        Adv: {pdfInr(r.advance || 0)}
                        {(r.advanceRefund ?? r.bookingRef?.advanceRefund ?? 0) > 0 ? ` (Ref: -${pdfInr(r.advanceRefund ?? r.bookingRef?.advanceRefund ?? 0)})` : ""}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.colBal}>
                    <Text style={[s.tdMono, s.right, { color: bal > 0 ? C.red : C.green }]}>
                      {r.status === "cancelled" ? "Rs. 0" : pdfInr(bal)}
                    </Text>
                  </View>
                  <View style={s.colStatus}>
                    <Text style={[s.tdText, { color: statusColor, fontFamily: "Helvetica-Bold" }]}>
                      {statusLabel}
                    </Text>
                  </View>
                </View>
              );
            })
          )}

          {/* Totals row */}
          <View style={s.totalsRow}>
            <Text style={[s.colToken, s.totalsLabel]}></Text>
            <Text style={[s.colCust, s.totalsLabel]}></Text>
            <Text style={[s.colItem, s.totalsLabel]}></Text>
            <Text style={[s.colBranch, s.totalsLabel]}></Text>
            <Text style={[s.colRdate, s.totalsLabel]}></Text>
            <Text style={[s.colDdate, s.totalsLabel]}>TOTALS</Text>
            <Text style={[s.colTotal, s.totalsValue]}>{pdfInr(totalRevenue)}</Text>
            <Text style={[s.colAdv, s.totalsValue, { color: C.green }]}>{pdfInr(totalAdvanceCol)}</Text>
            <Text style={[s.colBal, s.totalsValue, { color: C.red }]}>{pdfInr(totalBalance)}</Text>
            <Text style={s.colStatus}></Text>
          </View>
        </View>

        {/* ── FOOTER ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{shopBrand()} — Confidential</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
