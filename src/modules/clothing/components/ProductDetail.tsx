"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ImageOff, Pencil, QrCode, ShoppingBag, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { RENTAL_LIST_COLUMNS } from "@/lib/shop/api";
import { fmtDate, rupees } from "@/lib/shop/format";
import { headlinePrice } from "@/lib/shop/useCatalog";
import type { Product, Unit } from "@/lib/shop/types";
import type { ListRental } from "@/components/shop/RentalList";
import {
  StatusBadge,
  dangerButtonClass,
  ghostButtonClass,
  goldButtonClass,
} from "@/components/shop/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  stockTotals,
  type StockRow,
} from "@/modules/clothing/components/StockCard";

type PieceRow = Pick<
  Unit,
  "id" | "code" | "variation_id" | "branch_id" | "status" | "status_reason"
>;

const label = (key: string): string =>
  key.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());

function BusinessFact({
  name,
  value,
  hint,
}: {
  name: string;
  value: ReactNode;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <dt className="text-sm font-medium">{name}</dt>
      <dd className="text-right text-sm font-semibold tabular-nums">
        {value}
        {hint ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

export function ProductDetail({
  product,
  stock,
  onRent,
  onRemove,
}: {
  product: Product;
  stock: Map<string, StockRow> | null;
  onRent: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { tz, branches, activeBranches, categories, canManage, isOwner } =
    useShop();
  const branchName = (id: string): string =>
    branches.find((branch) => branch.id === id)?.name ?? "";
  const variations = (product.product_variations ?? []).filter(
    (variation) => variation.is_enabled,
  );
  const [rentals, setRentals] = useState<ListRental[] | null>(null);
  const [earned, setEarned] = useState(0);
  const [pieces, setPieces] = useState<PieceRow[] | null>(null);
  const [rentalsFailed, setRentalsFailed] = useState(false);
  const [piecesFailed, setPiecesFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const supabase = createClient();
      const [linesResult, unitsResult] = await Promise.all([
        supabase
          .from("rental_lines")
          .select("rental_id, amount")
          .eq("product_id", product.id)
          .limit(2000),
        supabase
          .from("units")
          .select("id, code, variation_id, branch_id, status, status_reason")
          .eq("product_id", product.id)
          .order("code")
          .limit(2000),
      ]);
      if (!live) return;
      if (unitsResult.error) setPiecesFailed(true);
      else setPieces(unitsResult.data ?? []);
      if (linesResult.error) {
        setRentalsFailed(true);
        return;
      }
      const lines = linesResult.data ?? [];
      const ids = Array.from(
        new Set(lines.map((line) => line.rental_id)),
      ).slice(0, 300);
      if (!ids.length) {
        setRentals([]);
        setEarned(0);
        return;
      }
      const { data, error } = await supabase
        .from("rentals")
        .select(RENTAL_LIST_COLUMNS)
        .in("id", ids)
        .in("status", ["reserved", "active", "completed"])
        .order("start_at");
      if (!live) return;
      if (error) {
        setRentalsFailed(true);
        return;
      }
      const rows = (data as unknown as ListRental[]) ?? [];
      setRentals(rows);
      const done = new Set(
        rows
          .filter((rental) => rental.status === "completed")
          .map((rental) => rental.id),
      );
      setEarned(
        lines
          .filter((line) => done.has(line.rental_id))
          .reduce((sum, line) => sum + Number(line.amount), 0),
      );
    })().catch(() => {
      if (!live) return;
      setRentalsFailed(true);
      setPiecesFailed(true);
    });
    return () => {
      live = false;
    };
  }, [product.id]);

  const { total, free } = stockTotals(stock, product);
  const variationIds = new Set(variations.map((variation) => variation.id));
  const stockRows = Array.from(stock?.values() ?? []).filter((row) =>
    variationIds.has(row.variation_id),
  );
  const piecesOut = stockRows.reduce((sum, row) => sum + row.out_now, 0);
  const piecesReserved = stockRows.reduce(
    (sum, row) => sum + Number(row.reserved_ahead ?? 0),
    0,
  );
  const piecesUnavailable = stockRows.reduce(
    (sum, row) => sum + Number(row.maintenance ?? 0) + Number(row.lost ?? 0),
    0,
  );
  const inventory = [
    { name: "Total pieces", value: total },
    { name: "Available now", value: free },
    { name: "Out on rent", value: piecesOut },
    { name: "Reserved ahead", value: piecesReserved },
    ...(piecesUnavailable
      ? [{ name: "In repair or lost", value: piecesUnavailable }]
      : []),
  ];

  const category = categories.find(
    (item) => item.id === product.category_id,
  )?.name;
  const out = (rentals ?? []).filter((rental) => rental.status === "active");
  const ahead = (rentals ?? []).filter(
    (rental) => rental.status === "reserved",
  );
  const timesRented = (rentals ?? []).filter(
    (rental) => rental.status === "completed" || rental.status === "active",
  ).length;
  const recovered =
    product.purchase_price > 0
      ? Math.round((earned / Number(product.purchase_price)) * 100)
      : null;
  const badge = !product.is_active ? (
    <StatusBadge tone="muted">Switched off</StatusBadge>
  ) : product.is_set ? (
    <StatusBadge tone="indigo">Set</StatusBadge>
  ) : stock === null ? (
    <StatusBadge>Checking stock</StatusBadge>
  ) : free > 0 ? (
    <StatusBadge tone="emerald">In stock</StatusBadge>
  ) : total === 0 ? (
    <StatusBadge tone="muted">No pieces</StatusBadge>
  ) : (
    <StatusBadge tone="rust">All out</StatusBadge>
  );

  return (
    <div className="min-w-0 space-y-5">
      <header className="space-y-4 border-b border-border pb-5">
        <div className="flex items-start gap-4 pr-8">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted text-muted-foreground sm:size-24">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageOff aria-hidden="true" className="size-6" />
            )}
          </div>
          <div className="min-w-0 self-center">
            <h2 className="font-display text-xl font-semibold leading-tight wrap-break-word sm:text-2xl">
              {product.name}
            </h2>
            <p className="mt-1 text-sm wrap-break-word text-muted-foreground">
              {category ? `${category} · ` : ""}
              {product.sku}
            </p>
            <div className="mt-2">{badge}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(goldButtonClass, "min-h-11")}
            onClick={onRent}
          >
            <ShoppingBag aria-hidden="true" className="size-4" /> Rent
          </button>
          {canManage ? (
            <Link
              href={`/catalog/${product.id}`}
              className={cn(ghostButtonClass, "min-h-11")}
            >
              <Pencil aria-hidden="true" className="size-4" /> Edit
            </Link>
          ) : null}
          {canManage ? (
            <Link
              href={`/print/tags?product=${product.id}`}
              className={cn(ghostButtonClass, "min-h-11")}
            >
              <QrCode aria-hidden="true" className="size-4" /> Print tags
            </Link>
          ) : null}
          {isOwner ? (
            <button
              type="button"
              className={cn(
                dangerButtonClass,
                "min-h-11 rounded-lg text-foreground",
              )}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" className="size-4" /> Remove
            </button>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue="stock" className="min-w-0">
        <TabsList
          aria-label="Product details"
          className={cn(
            "grid h-auto w-full gap-1 sm:flex sm:w-fit",
            canManage ? "grid-cols-2" : "grid-cols-3",
          )}
        >
          <TabsTrigger value="stock" className="min-h-11 max-sm:px-1.5">
            Stock
          </TabsTrigger>
          <TabsTrigger value="bookings" className="min-h-11 max-sm:px-1.5">
            Bookings
          </TabsTrigger>
          {canManage ? (
            <TabsTrigger value="business" className="min-h-11 max-sm:px-1.5">
              Business
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="pieces" className="min-h-11 max-sm:px-1.5">
            Pieces &amp; tags
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-5 space-y-5">
          {product.description ? (
            <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-line text-muted-foreground">
              {product.description}
            </p>
          ) : null}
          {product.is_set ? (
            <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              A set is available when every piece in it is free. Checkout checks
              availability for the rental dates.
            </p>
          ) : (
            <dl
              aria-label="Stock totals"
              className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg border border-border bg-muted/40 px-4 py-3 sm:gap-x-8"
            >
              {inventory.map(({ name, value }) => (
                <div key={name} className="min-w-24 flex-1">
                  <dt className="text-xs text-muted-foreground">{name}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                    {stock === null ? "—" : value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <section aria-labelledby="product-variations">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 id="product-variations" className="text-base font-semibold">
                Variations ({variations.length})
              </h3>
              {variations.length > 0 && activeBranches.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Available / total pieces
                </p>
              ) : null}
            </div>
            {variations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bookable variations.
              </p>
            ) : (
              <div
                role="region"
                aria-label="Variation rates and branch stock"
                tabIndex={0}
                className="overflow-x-auto rounded-lg border border-border bg-surface"
              >
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-xs font-medium text-muted-foreground">
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 min-w-32 bg-muted px-3 py-2.5 sm:px-4"
                      >
                        Variation
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2.5">
                        Price / day
                      </th>
                      {activeBranches.map((branch) => (
                        <th
                          key={branch.id}
                          scope="col"
                          className="min-w-18 px-3 py-2.5 text-center"
                        >
                          {branch.name}
                        </th>
                      ))}
                      {activeBranches.length > 1 ? (
                        <th
                          scope="col"
                          className="whitespace-nowrap px-3 py-2.5 text-center"
                        >
                          All branches
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {variations.map((variation) => {
                      const attrs = Object.entries(variation.attributes ?? {})
                        .filter(([, value]) => String(value ?? "").trim())
                        .map(([key, value]) => `${label(key)}: ${value}`)
                        .join(" · ");
                      const price = headlinePrice(variation);
                      const branchStock = activeBranches.map((branch) => ({
                        id: branch.id,
                        row: stock?.get(`${variation.id}:${branch.id}`),
                      }));
                      const combined = branchStock.reduce(
                        (sum, { row }) => ({
                          total: sum.total + (row?.total ?? 0),
                          free: sum.free + (row?.available_now ?? 0),
                        }),
                        { total: 0, free: 0 },
                      );
                      return (
                        <tr key={variation.id}>
                          <th
                            scope="row"
                            className="sticky left-0 bg-surface px-3 py-3 text-left font-medium sm:px-4"
                          >
                            <span className="block wrap-break-word">
                              {attrs || variation.name}
                            </span>
                            <span className="mt-0.5 block text-xs font-normal wrap-break-word text-muted-foreground">
                              {variation.sku}
                            </span>
                          </th>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                            {price ? rupees(price.amount) : "—"}
                          </td>
                          {branchStock.map(({ id, row }) => (
                            <td
                              key={id}
                              className={cn(
                                "px-3 py-3 text-center tabular-nums",
                                (row?.available_now ?? 0) > 0
                                  ? "font-semibold text-emerald"
                                  : "text-muted-foreground",
                              )}
                            >
                              {row?.total
                                ? `${row.available_now}/${row.total}`
                                : "—"}
                            </td>
                          ))}
                          {activeBranches.length > 1 ? (
                            <td className="px-3 py-3 text-center font-semibold tabular-nums">
                              {combined.total
                                ? `${combined.free}/${combined.total}`
                                : "—"}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="bookings" className="mt-5">
          {rentalsFailed ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Could not load bookings. Close and reopen the product to retry.
            </p>
          ) : rentals === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading bookings…
            </p>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <section aria-labelledby="product-out-now" className="space-y-2">
                <h3 id="product-out-now" className="text-base font-semibold">
                  Out now ({out.length})
                </h3>
                {out.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No pieces are out right now.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                    {out.map((rental) => {
                      const overdue = Date.parse(rental.end_at) < Date.now();
                      const branch = branchName(rental.branch_id);
                      return (
                        <li
                          key={rental.id}
                          className="flex flex-wrap items-center justify-between gap-3 p-3"
                        >
                          <Link
                            href={`/rentals/${rental.id}`}
                            className="min-w-0 flex-1 rounded-sm text-sm hover:underline"
                          >
                            <span className="block font-medium wrap-break-word">
                              {rental.customers?.full_name}
                            </span>
                            <span className="block text-xs text-gold">
                              {rental.token}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {overdue ? "Overdue · was due " : "Due "}
                              {fmtDate(rental.end_at, tz)}
                              {branch ? ` · ${branch}` : ""}
                            </span>
                          </Link>
                          <Link
                            href={`/rentals/${rental.id}?receive=1`}
                            className={cn(ghostButtonClass, "min-h-11")}
                          >
                            Return
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section
                aria-labelledby="product-booked-ahead"
                className="space-y-2"
              >
                <h3
                  id="product-booked-ahead"
                  className="text-base font-semibold"
                >
                  Booked ahead ({ahead.length})
                </h3>
                {ahead.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No upcoming bookings.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                    {ahead.map((rental) => (
                      <li key={rental.id}>
                        <Link
                          href={`/rentals/${rental.id}`}
                          className="block p-3 text-sm hover:bg-accent/40"
                        >
                          <span className="block font-medium wrap-break-word">
                            {rental.customers?.full_name}
                          </span>
                          <span className="block text-xs text-gold">
                            {rental.token}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Pickup {fmtDate(rental.start_at, tz)} →{" "}
                            {fmtDate(rental.end_at, tz)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </TabsContent>

        {canManage ? (
          <TabsContent value="business" className="mt-5">
            <h3 className="mb-2 text-base font-semibold">Business figures</h3>
            {rentalsFailed ? (
              <p role="alert" className="mb-2 text-sm text-muted-foreground">
                Could not load rental figures. Close and reopen the product to
                retry.
              </p>
            ) : null}
            <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
              <BusinessFact
                name="Times rented"
                value={
                  rentalsFailed ? "—" : rentals === null ? "…" : timesRented
                }
              />
              <BusinessFact
                name="Earned"
                value={
                  rentalsFailed ? "—" : rentals === null ? "…" : rupees(earned)
                }
                hint="from returned rentals"
              />
              <BusinessFact
                name="Cost price"
                value={
                  product.purchase_price > 0
                    ? rupees(product.purchase_price)
                    : "—"
                }
                hint={
                  rentals !== null && recovered !== null
                    ? `${recovered}% earned back`
                    : undefined
                }
              />
              <BusinessFact
                name="Replacement value"
                value={
                  product.replacement_value > 0
                    ? rupees(product.replacement_value)
                    : "—"
                }
                hint="charged if lost"
              />
            </dl>
          </TabsContent>
        ) : null}

        <TabsContent value="pieces" className="mt-5">
          <h3 className="mb-2 text-base font-semibold">
            Pieces and tags{pieces ? ` (${pieces.length})` : ""}
          </h3>
          {piecesFailed ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Could not load pieces. Close and reopen the product to retry.
            </p>
          ) : pieces === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading pieces…
            </p>
          ) : pieces.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "No pieces yet. Add stock from Edit."
                : "No pieces yet."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {pieces.map((piece) => {
                const variation = variations.find(
                  (item) => item.id === piece.variation_id,
                );
                const attributes = variation
                  ? Object.values(variation.attributes ?? {})
                      .filter((value) => String(value ?? "").trim())
                      .join(" / ") || variation.name
                  : "";
                const location = [attributes, branchName(piece.branch_id)]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li
                    key={piece.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium wrap-break-word">
                        {piece.code}
                      </p>
                      {location ? (
                        <p className="mt-0.5 text-xs wrap-break-word text-muted-foreground">
                          {location}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge
                      tone={
                        piece.status === "available"
                          ? "emerald"
                          : piece.status === "retired"
                            ? "muted"
                            : "rust"
                      }
                    >
                      {piece.status === "available"
                        ? "Available"
                        : piece.status_reason || piece.status}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
