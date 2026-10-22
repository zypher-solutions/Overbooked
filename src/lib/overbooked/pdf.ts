import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { format } from "date-fns";
import type { Rental } from "./types";
import { LedgerDocument } from "./LedgerDocument";

export async function generateLedgerPDF(
  rows: Rental[],
  filters?: { branch?: string; from?: string; to?: string; status?: string }
) {
  // Build the React element and pipe it through @react-pdf/renderer
  const element = createElement(LedgerDocument, { rows, filters });
  const blob = await pdf(element as any).toBlob();

  // Trigger a download
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Overbooked-Ledger-${format(new Date(), "yyyy-MM-dd")}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
