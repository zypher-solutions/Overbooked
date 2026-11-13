import Link from "next/link";
import { useState } from "react";
import { ImageOff, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
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

// Checkout items as one bill-like table: a row per product with its piece, quantity, rate and amount, then the
// accessories under it. On a phone each row stacks into a card; the column names show inside the cells instead.
const COLUMNS =
  "md:grid md:grid-cols-[2rem_minmax(0,2fr)_minmax(13rem,1.5fr)_6.5rem_minmax(6rem,1fr)_8rem_2.25rem] md:items-start md:gap-3";
const cellLabel =
  "mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground md:sr-only";
const iconButton =
  "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";

function CartProductPhoto({
  src,
  name,
}: {
  src?: string | null;
  name: string;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const frame = "size-12 shrink-0 rounded-lg border border-border bg-muted";

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

// the line amount: the catalogue price until someone types the price agreed with the customer
function AmountCell({
  label,
  price,
  agreed,
  onAgree,
}: {
  label: string;
  price: number | undefined;
  agreed: string;
  onAgree: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const shown =
    draft ?? (agreed.trim() !== "" ? agreed : price !== undefined ? String(price) : "");
  return (
    <div>
      <input
        className={cn(monoInputClass, "min-h-10 text-right")}
        inputMode="decimal"
        maxLength={10}
        aria-label={`Amount for ${label}`}
        placeholder={price === undefined ? "…" : undefined}
        value={shown}
        onFocus={(event) => {
          setDraft(shown);
          event.target.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const typed = draft.trim();
          // typing the catalogue price back (or clearing the box) returns to the catalogue price
          onAgree(
            typed === "" || (price !== undefined && typed === String(price))
              ? ""
              : typed,
          );
          setDraft(null);
        }}
      />
      {agreed.trim() !== "" && draft === null ? (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onAgree("")}
        >
          <RotateCcw aria-hidden="true" className="size-3" />
          Catalogue price
        </button>
      ) : null}
    </div>
  );
}

export function CheckoutCart({ f }: { f: BookingForm }): React.JSX.Element {
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
  const extras = visibleAddOns;
  const agreedError = f.moneyErrors.agreedPrice;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {count > 0
            ? `${plural(count, "item")} · choose the piece going out for each one.`
            : ""}
        </p>
        {periodOk &&
        f.branchId &&
        count > 0 &&
        !checkingStock &&
        !stockError &&
        !shortItems.length ? (
          <StatusBadge tone="emerald">All in stock</StatusBadge>
        ) : checkingStock ? (
          <p role="status" className="text-sm text-gold">
            Checking availability…
          </p>
        ) : null}
      </div>

      {periodOk && !checkingStock && !stockError && shortItems.length > 0 ? (
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

      <div
        role="table"
        aria-label="Cart items"
        className="mt-3 overflow-hidden rounded-xl border border-border"
      >
        <div
          role="row"
          className={cn(
            COLUMNS,
            "hidden bg-muted/70 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground",
          )}
        >
          <span role="columnheader">#</span>
          <span role="columnheader">Item</span>
          <span role="columnheader">Piece</span>
          <span role="columnheader" className="text-center">
            Qty
          </span>
          <span role="columnheader">Rate</span>
          <span role="columnheader" className="text-right">
            Amount (₹)
          </span>
          <span role="columnheader">
            <span className="sr-only">Remove</span>
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No items yet. Add them from{" "}
            <Link href="/scan" className="font-semibold text-gold underline">
              Inventory search
            </Link>{" "}
            or{" "}
            <Link href="/catalog" className="font-semibold text-gold underline">
              Products
            </Link>
            .
          </p>
        ) : null}

        {lines.map((line, row) => {
          const info = variations.get(line.variation_id);
          const savedLine = editing?.rental_lines.find(
            (item) => item.variation_id === line.variation_id,
          );
          const pricing = quoteLineFor(line.variation_id);
          const availablePieces = pieces?.[line.variation_id];
          const name =
            info?.product.name ?? savedLine?.description ?? "Loading item…";
          const label = info ? variationLabel(info.product, info.variation) : name;
          const photo = info?.product.image_url || savedLine?.image_url;
          const variant = info?.variation.name;
          const sku = info?.variation.sku ?? savedLine?.sku;
          const needsPieces = periodOk && pieceLines.includes(line);
          const catalogue =
            pricing && !pricing.is_override ? Number(pricing.amount) : undefined;
          return (
            <div
              key={line.variation_id}
              role="row"
              className={cn(
                COLUMNS,
                "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 border-t border-border px-3 py-3 first:border-t-0 md:first:border-t",
              )}
            >
              <span
                role="cell"
                className="hidden pt-3 text-sm tabular-nums text-muted-foreground md:block"
              >
                {row + 1}
              </span>
              <div role="cell" className="flex min-w-0 items-start gap-2.5">
                <CartProductPhoto key={photo} src={photo} name={name} />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold leading-snug">
                    {name}
                  </p>
                  {variant && variant !== name ? (
                    <p className="break-words text-xs text-muted-foreground">
                      {variant}
                    </p>
                  ) : null}
                  {sku ? (
                    <p className="break-words font-mono text-xs text-muted-foreground">
                      {sku}
                    </p>
                  ) : null}
                </div>
              </div>
              {/* on a phone, remove sits beside the item name */}
              <button
                type="button"
                aria-label={`Remove ${label} from the cart`}
                className={cn(iconButton, "hover:bg-rust/10 hover:text-rust md:hidden")}
                onClick={() =>
                  updateLine(line.variation_id, { qty: 0, unit_ids: [] })
                }
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>

              <div role="cell" className="col-span-2 min-w-0 space-y-1.5 md:col-span-1">
                <span className={cellLabel}>Piece</span>
                {!needsPieces ? (
                  <p className="pt-2 text-sm text-muted-foreground">
                    {periodOk ? "Not needed" : "Set the dates first"}
                  </p>
                ) : stockError ? (
                  <p className="pt-2 text-sm text-muted-foreground">
                    Could not check pieces.
                  </p>
                ) : !availablePieces ? (
                  <Skeleton className="h-10 w-full" />
                ) : availablePieces.length ? (
                  Array.from({ length: line.qty }, (_, index) => {
                    const selected = line.unit_ids[index] ?? "";
                    return (
                      <select
                        key={index}
                        className={cn(
                          inputClass,
                          "min-h-10",
                          !selected && "border-gold/60",
                        )}
                        value={selected}
                        aria-label={`Piece ${index + 1} of ${label}`}
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
                          {line.qty > 1 ? `Choose piece ${index + 1}` : "Choose a piece"}
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
                    );
                  })
                ) : (
                  <p className="pt-2 text-sm text-rust">
                    None free for these dates.
                  </p>
                )}
              </div>

              <div role="cell">
                <span className={cellLabel}>Qty</span>
                <div className="flex w-fit items-center rounded-lg border border-border bg-muted/40 md:mx-auto">
                  <button
                    type="button"
                    aria-label={`One less ${label}`}
                    className={iconButton}
                    onClick={() =>
                      updateLine(line.variation_id, {
                        qty: line.qty - 1,
                        unit_ids: line.unit_ids.slice(0, line.qty - 1),
                      })
                    }
                  >
                    <Minus aria-hidden="true" className="size-4" />
                  </button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    aria-label={`One more ${label}`}
                    className={iconButton}
                    onClick={() =>
                      updateLine(line.variation_id, { qty: line.qty + 1 })
                    }
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>

              <div role="cell" className="min-w-0 text-right md:text-left">
                <span className={cellLabel}>Rate</span>
                <p className="text-sm text-muted-foreground md:pt-2.5">
                  {pricing
                    ? pricing.is_override
                      ? "Agreed price"
                      : lineMath(pricing)
                    : periodOk
                      ? "…"
                      : "—"}
                </p>
              </div>

              <div role="cell" className="col-span-2 md:col-span-1">
                <span className={cellLabel}>Amount (₹)</span>
                <AmountCell
                  label={label}
                  price={catalogue}
                  agreed={line.amount_override}
                  onAgree={(value) =>
                    updateLine(line.variation_id, { amount_override: value })
                  }
                />
              </div>

              <div role="cell" className="hidden md:block">
                <button
                  type="button"
                  aria-label={`Remove ${label} from the cart`}
                  className={cn(iconButton, "hover:bg-rust/10 hover:text-rust")}
                  onClick={() =>
                    updateLine(line.variation_id, { qty: 0, unit_ids: [] })
                  }
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>
          );
        })}

        {quote?.lines
          .filter((line) => !line.reserve)
          .map((line, index) => (
            <div
              key={`charge-${index}`}
              role="row"
              className="flex justify-between gap-3 border-t border-border px-3 py-2.5 text-sm"
            >
              <span role="cell">{line.description}</span>
              <span role="cell" className="tabular-nums">
                {rupees(line.amount)}
              </span>
            </div>
          ))}

        {extras.length ? (
          <div role="rowgroup" className="border-t border-border bg-muted/30">
            <p className="px-3 pt-2.5 text-xs font-semibold tracking-wide text-muted-foreground">
              Accessories · tick the ones the customer is taking
            </p>
            {extras.map((extra) => {
              const quantity = d.addOns[extra.id];
              const price = quote?.add_ons.find(
                (item) => item.add_on_id === extra.id,
              );
              return (
                <div
                  key={extra.id}
                  role="row"
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm"
                >
                  <label role="cell" className="flex min-w-0 flex-1 items-start gap-2">
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
                      <span className="ml-1.5 text-muted-foreground">
                        {Number(extra.amount) > 0
                          ? `${rupees(extra.amount)} ${BASIS_LABELS[extra.basis]}`
                          : "Free"}
                        {extra.quantity != null
                          ? ` · ${extra.quantity} in the shop`
                          : ""}
                      </span>
                    </span>
                  </label>
                  {quantity !== undefined &&
                  (extra.basis === "per_rental" ||
                    extra.basis === "per_day") ? (
                    <input
                      type="number"
                      min={1}
                      aria-label={`How many ${extra.name}`}
                      className={cn(monoInputClass, "min-h-9 w-16")}
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
                  <span role="cell" className="w-24 text-right tabular-nums">
                    {price ? rupees(price.amount) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {agreedError ? (
        <p role="alert" className="mt-2 text-sm text-rust">
          {agreedError}
        </p>
      ) : null}
    </div>
  );
}
