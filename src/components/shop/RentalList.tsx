"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useShop } from "@/lib/shop/ShopContext";
import { fmtDateTime, rupees } from "@/lib/shop/format";
import type { Rental } from "@/lib/shop/types";
import { BalanceBadge, Empty, RentalStatusBadge } from "./ui";

export type ListRental = Pick<Rental, "id" | "token" | "status" | "start_at" | "end_at" | "total" | "paid" | "branch_id"> & {
  customers?: { id: string; full_name: string; phone: string } | null;
  rental_lines?: { description: string; qty: number; kind?: string }[];
};

export function itemsSummary(lines: { description: string; qty: number }[] | undefined) {
  if (!lines?.length) return "";
  const first = lines[0];
  const firstText = (first.qty > 1 ? `${first.qty} × ` : "") + first.description;
  return lines.length === 1 ? firstText : `${firstText} + ${lines.length - 1} more`;
}

// "when" shows the time that matters for the status: pickup for bookings, return for rentals out
export function RentalList({ rentals, when = "auto", empty }: {
  rentals: ListRental[];
  when?: "auto" | "start" | "end";
  empty: string;
}) {
  const { tz, branches, activeBranches } = useShop();
  if (rentals.length === 0) return <Empty>{empty}</Empty>;
  const showBranch = activeBranches.length > 1;

  return (
    <ul className="divide-y divide-border">
      {rentals.map((r) => {
        const useEnd = when === "end" || (when === "auto" && r.status === "active");
        const due = Number(r.total) - Number(r.paid);
        return (
          <li key={r.id}>
            <Link href={`/rentals/${r.id}`} className="flex items-center gap-3 py-3 hover:bg-black/[0.02]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gold">{r.token}</span>
                  <span className="truncate font-medium text-foreground">{r.customers?.full_name ?? "—"}</span>
                  <RentalStatusBadge rental={r} room={!!r.rental_lines?.length && r.rental_lines.every((x) => x.kind === "room")} />
                  <BalanceBadge rental={r} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {itemsSummary(r.rental_lines)}
                  {showBranch ? ` · ${branches.find((b) => b.id === r.branch_id)?.name ?? ""}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="text-foreground">{useEnd ? "Due back " : "From "}{fmtDateTime(useEnd ? r.end_at : r.start_at, tz)}</p>
                {due > 0 && r.status !== "cancelled" && r.status !== "no_show" ? <p className="text-rust">{rupees(due)} due</p> : null}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
