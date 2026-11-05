import Link from "next/link";
import { useState } from "react";
import { ImageOff, Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BASIS_LABELS, lineMath, num, plural, rupees } from "@/lib/shop/format";
import { variationLabel } from "@/lib/shop/useCatalog";
import {
  StatusBadge,
  inputClass,
  monoInputClass,
  Skeleton,
} from "@/components/shop/ui";
import type { BookingForm } from "@/components/shop/useBookingForm";

const cartButton =
  "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";

function CartProductPhoto({
  src,
  name,
  compact,
}: {
  src?: string | null;
  name: string;
  compact: boolean;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const frame = cn(
    "shrink-0 rounded-lg border border-border bg-muted",
    compact ? "size-11" : "size-16",
  );

  return src && !failed ? (
    <img
      src={src}
      alt={`${name} product photo`}
      className={cn(frame, "object-cover")}
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      role="img"
      aria-label="No product photo"
      className={cn(frame, "grid place-items-center text-muted-foreground")}
    >
      <ImageOff aria-hidden="true" className="size-5" />
    </span>
  );
}

export function CheckoutCart({
  f,
  editable,
}: {
  f: BookingForm;
  editable: boolean;
}): React.JSX.Element {
  const {
    d,
    editing,
    lines,
    variations,
    periodOk,
    checkingStock,
    stockError,
    shortItems,
    pieceLines,
    pieces,
    avail,
    updateLine,
    quote,
    quoteLineFor,
    visibleAddOns,
    set,
  } = f;
  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const extras = editable
    ? visibleAddOns
    : visibleAddOns.filter((extra) => d.addOns[extra.id] !== undefined);

  return (
    <aside
      aria-labelledby="checkout-cart-title"
      className={cn(
        "min-w-0 shrink-0 border-border bg-surface-2 px-4 py-4 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:border-l",
        editable
          ? "border-t lg:border-t-0"
          : "sticky top-0 z-10 order-first max-h-[28dvh] overflow-y-auto border-b lg:static lg:order-none lg:max-h-none lg:border-b-0",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="checkout-cart-title" className="text-base font-semibold">
          Cart items ({count})
        </h2>
        {periodOk &&
        f.branchId &&
        count > 0 &&
        !checkingStock &&
        !stockError &&
        !shortItems.length ? (
          <StatusBadge tone="emerald">In stock</StatusBadge>
        ) : null}
      </div>
      {editable && count > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Check quantities and assign the pieces going out.
        </p>
      ) : null}
      {count === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Add items from{" "}
          <Link href="/scan" className="font-semibold text-gold underline">
            Inventory Search
          </Link>{" "}
          or{" "}
          <Link href="/catalog" className="font-semibold text-gold underline">
            All Products
          </Link>
          .
        </p>
      ) : null}
      {editable && checkingStock ? (
        <p role="status" className="mt-3 text-sm text-gold">
          Checking piece availability…
        </p>
      ) : null}
      {editable &&
      periodOk &&
      !checkingStock &&
      !stockError &&
      shortItems.length > 0 ? (
        <div className="mt-3 rounded-lg border border-rust/35 bg-rust/5 p-3 text-sm">
          <p className="font-semibold">Not available for these dates</p>
          <ul className="mt-1 list-inside list-disc">
            {shortItems.map((line) => {
              const info = variations.get(line.variation_id);
              const free = pieceLines.includes(line)
                ? pieces?.[line.variation_id]?.length
                : avail[line.variation_id]?.free;
              return (
                <li key={line.variation_id}>
                  {info ? variationLabel(info.product, info.variation) : "Item"}{" "}
                  · {free ?? 0} available, {line.qty} needed
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-muted-foreground">
            Change the dates or reduce the quantity.
          </p>
        </div>
      ) : null}

      <ul className="mt-3 space-y-2.5">
        {lines.map((line) => {
          const info = variations.get(line.variation_id);
          const savedLine = editing?.rental_lines.find(
            (item) => item.variation_id === line.variation_id,
          );
          const pricing = quoteLineFor(line.variation_id);
          const availablePieces = pieces?.[line.variation_id];
          const name =
            info?.product.name ?? savedLine?.description ?? "Loading item…";
          const photo = info?.product.image_url || savedLine?.image_url;
          const variant = info?.variation.name;
          const sku = info?.variation.sku ?? savedLine?.sku;
          return (
            <li
              key={line.variation_id}
              className={cn(
                "rounded-xl border border-border bg-surface",
                editable ? "p-3" : "p-2.5",
              )}
            >
              <div className="flex items-start gap-2.5">
                <CartProductPhoto
                  key={photo}
                  src={photo}
                  name={name}
                  compact={!editable}
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm leading-snug font-semibold">
                    {name}
                  </p>
                  {variant && variant !== name ? (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {variant}
                    </p>
                  ) : null}
                  {sku ? (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {sku}
                    </p>
                  ) : null}
                  {!editable ? (
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                      <span className="text-muted-foreground">
                        Qty {line.qty}
                      </span>
                      {pricing ? (
                        <strong className="text-sm tabular-nums">
                          {rupees(pricing.amount)}
                        </strong>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {editable ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-border pt-2.5">
                  {pricing ? (
                    <div>
                      <p className="text-sm font-semibold tabular-nums">
                        {rupees(pricing.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pricing.is_override
                          ? "Agreed price"
                          : lineMath(pricing)}
                      </p>
                    </div>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <div className="flex items-center rounded-lg border border-border bg-muted/40">
                      <button
                        type="button"
                        aria-label="One less"
                        className={cartButton}
                        onClick={() =>
                          updateLine(line.variation_id, {
                            qty: line.qty - 1,
                            unit_ids: line.unit_ids.slice(0, line.qty - 1),
                          })
                        }
                      >
                        <Minus aria-hidden="true" className="size-4" />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        aria-label="One more"
                        className={cartButton}
                        onClick={() =>
                          updateLine(line.variation_id, { qty: line.qty + 1 })
                        }
                      >
                        <Plus aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove from cart"
                      className={cn(
                        cartButton,
                        "hover:bg-rust/10 hover:text-rust",
                      )}
                      onClick={() =>
                        updateLine(line.variation_id, { qty: 0, unit_ids: [] })
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </div>
              ) : null}
              {editable && periodOk && pieceLines.includes(line) ? (
                <div className="mt-3 space-y-2 border-t border-border pt-2.5">
                  <p className="text-sm font-semibold">
                    Physical pieces{" "}
                    <span className="font-normal text-muted-foreground">
                      · Required
                    </span>
                  </p>
                  {stockError ? (
                    <p className="text-sm text-muted-foreground">
                      Piece availability could not be checked.
                    </p>
                  ) : !availablePieces ? (
                    <Skeleton className="h-10 w-full" />
                  ) : availablePieces.length ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {plural(availablePieces.length, "piece")} available
                      </p>
                      {Array.from({ length: line.qty }, (_, index) => {
                        const selected = line.unit_ids[index] ?? "";
                        return (
                          <label
                            key={index}
                            className="block space-y-1 text-sm"
                          >
                            {line.qty > 1 ? (
                              <span>Piece {index + 1}</span>
                            ) : null}
                            <select
                              className={cn(inputClass, "min-h-11")}
                              value={selected}
                              aria-label={`Piece ${index + 1} of ${info ? variationLabel(info.product, info.variation) : "item"}`}
                              onChange={(event) => {
                                const ids = Array.from(
                                  { length: line.qty },
                                  (_, i) => line.unit_ids[i] ?? "",
                                );
                                ids[index] = event.target.value;
                                updateLine(line.variation_id, {
                                  unit_ids: ids.filter(Boolean),
                                });
                              }}
                            >
                              <option value="" disabled>
                                Choose a piece
                              </option>
                              {availablePieces.map((piece) => (
                                <option
                                  key={piece.unit_id}
                                  value={piece.unit_id}
                                  disabled={
                                    selected !== piece.unit_id &&
                                    line.unit_ids.includes(piece.unit_id)
                                  }
                                >
                                  {piece.code}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </>
                  ) : (
                    <p className="text-sm text-rust">
                      No physical pieces available for these dates.
                    </p>
                  )}
                </div>
              ) : null}
              {!editable && line.unit_ids.length ? (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {line.unit_ids
                    .map(
                      (id) =>
                        availablePieces?.find((piece) => piece.unit_id === id)
                          ?.code,
                    )
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {quote?.lines
        .filter((line) => !line.reserve)
        .map((line, index) => (
          <p key={index} className="mt-2 flex justify-between gap-3 text-sm">
            <span>{line.description}</span>
            <span className="tabular-nums">{rupees(line.amount)}</span>
          </p>
        ))}

      {extras.length ? (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Extras</h3>
          <ul className="space-y-2">
            {extras.map((extra) => {
              const quantity = d.addOns[extra.id];
              const price = quote?.add_ons.find(
                (item) => item.add_on_id === extra.id,
              );
              return (
                <li
                  key={extra.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  {editable ? (
                    <label className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 accent-gold"
                        checked={quantity !== undefined}
                        onChange={(event) => {
                          const next = { ...d.addOns };
                          if (event.target.checked) next[extra.id] = 1;
                          else delete next[extra.id];
                          set({ addOns: next });
                        }}
                      />
                      <span className="min-w-0 break-words">
                        {extra.name}
                        <span className="block text-muted-foreground">
                          {rupees(extra.amount)} {BASIS_LABELS[extra.basis]}
                        </span>
                      </span>
                    </label>
                  ) : (
                    <span>{extra.name}</span>
                  )}
                  {editable &&
                  quantity !== undefined &&
                  (extra.basis === "per_rental" ||
                    extra.basis === "per_day") ? (
                    <input
                      type="number"
                      min={1}
                      aria-label={`How many ${extra.name}`}
                      className={cn(monoInputClass, "min-h-10 w-16")}
                      value={quantity}
                      onChange={(event) =>
                        set({
                          addOns: {
                            ...d.addOns,
                            [extra.id]: Math.max(
                              1,
                              Math.floor(num(event.target.value)),
                            ),
                          },
                        })
                      }
                    />
                  ) : null}
                  {price ? (
                    <span className="ml-auto tabular-nums">
                      {rupees(price.amount)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {quote && count > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
          <span className="font-medium">Cart subtotal</span>
          <strong className="tabular-nums">
            {rupees(quote.total_before_discount)}
          </strong>
        </div>
      ) : null}
    </aside>
  );
}
