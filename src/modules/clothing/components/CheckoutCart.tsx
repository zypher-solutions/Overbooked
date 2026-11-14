import Link from "next/link";
import { useState } from "react";
import { Check, ImageOff, Minus, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BASIS_LABELS, lineMath, num, plural, rupees } from "@/lib/shop/format";
import { variationLabel } from "@/lib/shop/useCatalog";
import {
  StatusBadge,
  ghostButtonClass,
  inputClass,
  monoInputClass,
  Skeleton,
} from "@/components/shop/ui";
import type { BookingForm } from "@/components/shop/useBookingForm";
import type { AddOn } from "@/lib/shop/types";

// Checkout items as one bill-like table: a row per product with its piece, quantity, rate and amount, then the
// accessories under it. On a phone each row stacks into a card; the column names show inside the cells instead.
const COLUMNS =
  "@min-[44rem]:grid @min-[44rem]:grid-cols-[1.5rem_minmax(0,2fr)_minmax(9rem,1.5fr)_6.5rem_minmax(5rem,1fr)_6.5rem_2.25rem] @min-[44rem]:items-start @min-[44rem]:gap-3";
const cellLabel =
  "mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground @min-[44rem]:sr-only";
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
  const frame = "size-10 shrink-0 rounded-lg border border-border bg-muted";

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
    set,
  } = f;
  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const agreedError = f.moneyErrors.agreedPrice;
  const acc = useAccessories(f);

  return (
    <div className="@container min-w-0 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {count > 0 ? plural(count, "item") : ""}
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
        <div
          role="alert"
          className="mt-2 shrink-0 rounded-lg border border-rust/35 bg-rust/5 px-3 py-2 text-sm"
        >
          <span className="font-semibold">Not available for these dates: </span>
          {shortItems.map((line, index) => {
            const info = variations.get(line.variation_id);
            const free = pieceLines.includes(line)
              ? pieces?.[line.variation_id]?.length
              : avail[line.variation_id]?.free;
            return (
              <span key={line.variation_id}>
                {index > 0 ? "; " : ""}
                {info ? variationLabel(info.product, info.variation) : "Item"}{" "}
                ({free ?? 0} available, {line.qty} needed)
              </span>
            );
          })}
        </div>
      ) : null}

      <div
        role="table"
        aria-label="Cart items"
        className="mt-2 overflow-hidden rounded-xl border border-border xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
      >
        <div
          role="row"
          className={cn(
            COLUMNS,
            "hidden shrink-0 bg-muted/70 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground",
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

        {/* only this part scrolls on a wide screen, so the dates, customer and bill stay put however many items there are */}
        <div className="xl:min-h-[7rem] xl:flex-1 xl:overflow-y-auto">
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
                "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-t border-border px-3 py-2 first:border-t-0 @min-[44rem]:first:border-t",
              )}
            >
              <span
                role="cell"
                className="hidden pt-2.5 text-sm tabular-nums text-muted-foreground @min-[44rem]:block"
              >
                {row + 1}
              </span>
              <div role="cell" className="flex min-w-0 items-start gap-2.5">
                <CartProductPhoto key={photo} src={photo} name={name} />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold leading-snug">
                    {name}
                  </p>
                  <p className="break-words text-xs text-muted-foreground">
                    {[variant && variant !== name ? variant : null, sku]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              {/* on a phone, remove sits beside the item name */}
              <button
                type="button"
                aria-label={`Remove ${label} from the cart`}
                className={cn(iconButton, "hover:bg-rust/10 hover:text-rust @min-[44rem]:hidden")}
                onClick={() =>
                  updateLine(line.variation_id, { qty: 0, unit_ids: [] })
                }
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>

              <div role="cell" className="col-span-2 min-w-0 space-y-1.5 @min-[44rem]:col-span-1">
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
                <div className="flex w-fit items-center rounded-lg border border-border bg-muted/40 @min-[44rem]:mx-auto">
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

              <div role="cell" className="min-w-0 text-right @min-[44rem]:text-left">
                <span className={cellLabel}>Rate</span>
                <p className="text-sm text-muted-foreground @min-[44rem]:pt-2.5">
                  {pricing
                    ? pricing.is_override
                      ? "Agreed price"
                      : lineMath(pricing)
                    : periodOk
                      ? "…"
                      : "—"}
                </p>
              </div>

              <div role="cell" className="col-span-2 @min-[44rem]:col-span-1">
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

              <div role="cell" className="hidden @min-[44rem]:block">
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

        <AccessoryChosen a={acc} />
        </div>
        <AccessoryBar a={acc} />
      </div>
      {agreedError ? (
        <p role="alert" className="mt-2 shrink-0 text-sm text-rust">
          {agreedError}
        </p>
      ) : null}
    </div>
  );
}

// Accessories on the bill, laid out in the page (no dropdown), for shops with a hundred or more of them:
//   * a search box that is always there, and tiles under it: with nothing typed, the ones suggested for this cart and the
//     ones used recently on this device; while typing, every accessory whose name, product or category matches
//   * a tap adds one (again: one more), the search stays ready for the next, so a whole set goes in quickly
//   * each added one is a row with how many, the rate, an amount that can be agreed, and remove
// A counted accessory shows how many are free for the dates and cannot go above that; the database refuses it too (044).
const RECENT = 8;
const TILES = 6; // tiles shown at once (one row); typing or "Show all" gives the rest
const recentKey = (shopId: string) => `ob_recent_accessories_${shopId}`;
function readRecent(shopId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(recentKey(shopId)) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function rememberRecent(shopId: string, id: string): void {
  try {
    localStorage.setItem(recentKey(shopId), JSON.stringify([id, ...readRecent(shopId).filter((x) => x !== id)].slice(0, RECENT)));
  } catch {
    // storage may be blocked; recents are only a convenience
  }
}

// The state behind the accessory picker, shared by the rows of what was added (they scroll with the items) and the
// compact bar that stays pinned under the list.
function useAccessories(f: BookingForm) {
  const { d, set, quote, periodOk, pickableAddOns, suggestedAddOns, addOnFree, shop, products, categories } = f;
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecent(shop.id)));
  const [all, setAll] = useState(false);

  const chosen = pickableAddOns.filter((a) => d.addOns[a.id] !== undefined);
  const freeOf = (id: string) => (periodOk ? addOnFree[id] : undefined);
  const setQty = (id: string, qty: number) => set({ addOns: { ...d.addOns, [id]: qty } });
  // a tap adds one; again, one more
  const add = (a: AddOn) => {
    const free = freeOf(a.id);
    const now = d.addOns[a.id] ?? 0;
    if (free !== undefined && now >= free) return;
    setQty(a.id, now + 1);
    rememberRecent(shop.id, a.id);
    setRecent(readRecent(shop.id));
  };
  const remove = (id: string) => {
    const addOns = { ...d.addOns };
    const prices = { ...(d.addOnPrices ?? {}) };
    delete addOns[id];
    delete prices[id];
    set({ addOns, addOnPrices: prices });
  };
  const rateText = (a: AddOn) => (Number(a.amount) > 0 ? `${rupees(a.amount)} ${BASIS_LABELS[a.basis]}` : "Free");
  // what a search matches: the name, and the products and categories it goes with
  const haystack = (a: AddOn) => [
    a.name,
    ...(a.product_ids ?? []).map((id) => products?.find((p) => p.id === id)?.name ?? ""),
    ...(a.category_ids ?? []).map((id) => categories.find((c) => c.id === id)?.name ?? ""),
  ].join(" ").toLowerCase();

  const term = search.trim().toLowerCase();
  const suggestedIds = new Set(suggestedAddOns.map((a) => a.id));
  const recentList = recent.map((id) => pickableAddOns.find((a) => a.id === id)).filter((a): a is AddOn => !!a && !suggestedIds.has(a.id));
  const matches = term
    ? pickableAddOns.filter((a) => haystack(a).includes(term))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) || a.name.localeCompare(b.name))
    : all ? pickableAddOns : [...suggestedAddOns, ...recentList];
  const tiles = term || all ? matches.slice(0, all && !term ? matches.length : 12) : matches.slice(0, TILES);
  const notShown = (term ? matches.length : pickableAddOns.length) - tiles.length;
  const heading = term ? `${matches.length} found` : all ? "All accessories" : suggestedAddOns.length ? "Suggested" : recentList.length ? "Used recently" : "";

  return { d, set, quote, pickableAddOns, chosen, freeOf, setQty, add, remove, rateText, search, setSearch, term, matches, tiles, notShown, heading, all, setAll };
}
type Accessories = ReturnType<typeof useAccessories>;

// The accessories already on the bill: one row each with how many, the rate, an amount that can be agreed, and remove.
// A counted accessory shows how many are free for the dates and cannot go above that; the database refuses it too (044).
function AccessoryChosen({ a }: { a: Accessories }): React.JSX.Element | null {
  const { d, set, quote, chosen, freeOf, setQty, remove, rateText } = a;
  if (!chosen.length) return null;
  return (
    <div role="rowgroup" aria-label="Accessories on this bill">
      {chosen.map((x) => {
        const qty = d.addOns[x.id];
        const free = freeOf(x.id);
        const priced = quote?.add_ons.find((p) => p.add_on_id === x.id);
        const agreed = d.addOnPrices?.[x.id] ?? "";
        const catalogue = priced && !priced.is_override ? Number(priced.amount) : undefined;
        const over = free !== undefined && qty > free;
        return (
          <div key={x.id} role="row"
            className={cn(COLUMNS, "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-t border-border px-3 py-2")}>
            <span role="cell" className="hidden @min-[44rem]:block" />
            <div role="cell" className="min-w-0 pt-2 text-sm">
              <span className="font-medium">{x.name}</span>
              <span className={cn("ml-2 text-xs", over ? "font-semibold text-rust" : "text-muted-foreground")}>
                Accessory
                {free !== undefined ? (over ? ` · only ${free} free for these dates` : ` · ${free} free`) : ""}
              </span>
            </div>
            <button type="button" aria-label={`Remove ${x.name}`} className={cn(iconButton, "hover:bg-rust/10 hover:text-rust @min-[44rem]:hidden")} onClick={() => remove(x.id)}>
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
            <span role="cell" className="hidden @min-[44rem]:block" />
            <div role="cell">
              <span className={cellLabel}>Qty</span>
              <div className="flex w-fit items-center rounded-lg border border-border bg-muted/40 @min-[44rem]:mx-auto">
                <button type="button" aria-label={`One less ${x.name}`} className={iconButton} disabled={qty <= 1} onClick={() => setQty(x.id, qty - 1)}>
                  <Minus aria-hidden="true" className="size-4" />
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                <button type="button" aria-label={`One more ${x.name}`} className={iconButton} disabled={free !== undefined && qty >= free} onClick={() => setQty(x.id, qty + 1)}>
                  <Plus aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>
            <div role="cell" className="min-w-0 text-right @min-[44rem]:text-left">
              <span className={cellLabel}>Rate</span>
              <p className="text-sm text-muted-foreground @min-[44rem]:pt-2.5">{priced?.is_override ? "Agreed price" : rateText(x)}</p>
            </div>
            <div role="cell" className="col-span-2 @min-[44rem]:col-span-1">
              <span className={cellLabel}>Amount (₹)</span>
              <AmountCell label={x.name} price={catalogue} agreed={agreed}
                onAgree={(value) => set({ addOnPrices: { ...(d.addOnPrices ?? {}), [x.id]: value } })} />
            </div>
            <div role="cell" className="hidden @min-[44rem]:block">
              <button type="button" aria-label={`Remove ${x.name}`} className={cn(iconButton, "hover:bg-rust/10 hover:text-rust")} onClick={() => remove(x.id)}>
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Adding: one slim bar that is always in view under the list, with no layer over the page. A search box and tiles for the
// suggested and recent ones; while typing, every accessory whose name, product or category matches. A tap adds one (again:
// one more), and Enter adds the best match, so a whole set goes in quickly.
function AccessoryBar({ a }: { a: Accessories }): React.JSX.Element | null {
  const { d, pickableAddOns, chosen, search, setSearch, term, matches, tiles, notShown, heading, all, setAll, add, freeOf, rateText } = a;
  if (!pickableAddOns.length) return null;
  return (
    <div role="group" aria-label="Accessories" className="shrink-0 border-t-2 border-border bg-muted/30 px-3 py-2">
      <div className="flex max-h-36 flex-wrap items-center gap-x-2 gap-y-1.5 overflow-y-auto">
        <label className="relative block w-full sm:w-56">
          <span className="sr-only">Find an accessory</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" className={cn(inputClass, "min-h-9 bg-white pl-9")} value={search}
            placeholder={pickableAddOns.length > TILES ? `Find among ${pickableAddOns.length} accessories` : "Find an accessory"}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the best match
              if (e.key === "Enter" && term && matches[0]) { e.preventDefault(); add(matches[0]); }
            }} />
        </label>
        <span className="text-xs font-semibold text-muted-foreground">
          {heading || "Accessories"}
          {!term && chosen.length ? ` · ${chosen.length} added` : ""}
        </span>
        <ul className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Accessories to add">
          {tiles.map((x) => {
            const free = freeOf(x.id);
            const qty = d.addOns[x.id];
            const full = free !== undefined && (qty ?? 0) >= free;
            return (
              <li key={x.id}>
                <button type="button" disabled={full} onClick={() => add(x)}
                  aria-label={`${qty ? "One more" : "Add"} ${x.name}`}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-left text-sm shadow-sm transition-colors",
                    "hover:border-gold hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                    "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input disabled:hover:bg-white",
                    qty ? "border-gold bg-gold/5" : "border-input",
                  )}>
                  <span className="font-medium">{x.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {free === 0 ? "None free" : full ? "All taken" : free !== undefined ? `${free} free` : rateText(x)}
                  </span>
                  {qty ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-gold px-1.5 text-xs font-semibold text-white">
                      <Check aria-hidden="true" className="size-3" /> {qty}
                    </span>
                  ) : (
                    <Plus aria-hidden="true" className="size-3.5 text-gold" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {!term && notShown > 0 ? (
          <button type="button" className="text-xs font-semibold text-gold hover:underline" onClick={() => setAll((v) => !v)}>
            {`Show all ${pickableAddOns.length}`}
          </button>
        ) : !term && all ? (
          <button type="button" className="text-xs font-semibold text-gold hover:underline" onClick={() => setAll(false)}>
            Show fewer
          </button>
        ) : term && notShown > 0 ? (
          <span className="text-xs text-muted-foreground">{notShown} more match. Keep typing to narrow it down.</span>
        ) : null}
      </div>
      {term && !tiles.length ? (
        <p className="mt-1.5 text-sm text-muted-foreground">No accessory matches &quot;{search.trim()}&quot;.</p>
      ) : null}
    </div>
  );
}
