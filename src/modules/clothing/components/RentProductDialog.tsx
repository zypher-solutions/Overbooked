"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImageOff, Search, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/shop/format";
import { useShop } from "@/lib/shop/ShopContext";
import type { Product } from "@/lib/shop/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ghostButtonClass, goldButtonClass } from "@/components/shop/ui";
import {
  matchingVariations,
  StockCard,
  type StockRow,
} from "@/modules/clothing/components/StockCard";
import { useCart } from "@/modules/clothing/cart";

const swatches: Record<string, string> = {
  black: "#111111",
  white: "#ffffff",
  red: "#c62828",
  maroon: "#7b1e3a",
  wine: "#722f37",
  pink: "#e8799f",
  "hot pink": "#e91e8c",
  peach: "#ffb08a",
  orange: "#ef7d22",
  yellow: "#f4d03f",
  mustard: "#c9992b",
  gold: "#c9a227",
  green: "#2e8b57",
  "bottle green": "#0b5d3b",
  olive: "#6b6b2a",
  teal: "#1a8a8a",
  blue: "#2a6fd6",
  "royal blue": "#2646b3",
  navy: "#17224d",
  "sky blue": "#7ec0ee",
  purple: "#7b3fa0",
  lavender: "#b9a3dd",
  violet: "#6a3fb5",
  grey: "#8a8f94",
  gray: "#8a8f94",
  silver: "#c2c6ca",
  brown: "#7a5133",
  beige: "#d9c4a3",
  cream: "#f3ead2",
  ivory: "#f7f1e1",
  rust: "#b5532f",
};

export function RentProductDialog({
  product,
  stock,
  dailyPrice,
  onClose,
}: {
  product: Product;
  stock: Map<string, StockRow> | null;
  dailyPrice: string;
  onClose: () => void;
}): React.JSX.Element {
  const { templateOf } = useShop();
  const cart = useCart();
  const variants = matchingVariations(product);
  const templateFields =
    templateOf(product.category_id)?.variation_fields ?? [];
  const keys = [
    ...new Set([
      ...templateFields.map((field) => field.key),
      ...variants.flatMap((variant) => Object.keys(variant.attributes ?? {})),
    ]),
  ];
  const options = keys
    .map((key) => ({
      key,
      label:
        templateFields.find((field) => field.key === key)?.label ??
        key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
      values: [
        ...new Set(
          variants
            .map((variant) => String(variant.attributes?.[key] ?? "").trim())
            .filter(Boolean),
        ),
      ],
    }))
    .filter(({ values }) => values.length > 1);
  const [searched, setSearched] = useState(false);
  const [pick, setPick] = useState<Record<string, string[]>>({});
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const showingStock = searched || options.length === 0;
  const matchCount = matchingVariations(product, pick).length;
  const hasFilters = Object.values(pick).some((values) => values.length > 0);

  useEffect(() => {
    if (searched) resultsHeading.current?.focus({ preventScroll: true });
  }, [searched]);

  function toggle(key: string, value: string): void {
    setPick((current) => {
      const values = current[key] ?? [];
      return {
        ...current,
        [key]: values.includes(value)
          ? values.filter((selected) => selected !== value)
          : [...values, value],
      };
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden! bg-surface p-0 max-sm:p-0 sm:max-w-3xl sm:rounded-2xl">
        <header className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-4 pr-14 sm:px-6 sm:pr-14">
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <ImageOff aria-hidden="true" className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <DialogTitle className="break-words font-display text-xl leading-tight">
              {product.name}
            </DialogTitle>
            <DialogDescription className="mt-1 break-words">
              {product.sku}
              {!showingStock && dailyPrice !== "No price"
                ? ` · ${dailyPrice} / day`
                : ""}
            </DialogDescription>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {options.length ? (
            <section
              aria-label="Variation filters"
              className="border-b border-border bg-surface-2/50 px-4 py-4 sm:px-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {showingStock ? "Filter variations" : "Choose variations"}
                </h2>
                {showingStock && hasFilters ? (
                  <button
                    type="button"
                    className="min-h-10 rounded-md px-2 text-sm font-semibold text-gold hover:bg-accent"
                    onClick={() => setPick({})}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {showingStock
                  ? "Change your selection to update the results below."
                  : "Select the colours and sizes you need, or view every variation."}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
                {options.map(({ key, label, values }) => (
                  <fieldset key={key} className="min-w-0 max-w-full">
                    <legend className="mb-2 text-sm font-semibold">
                      {label}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {values.map((value) => {
                        const selected = pick[key]?.includes(value) ?? false;
                        const swatch = /^colou?r$/i.test(key)
                          ? swatches[value.toLowerCase()]
                          : undefined;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggle(key, value)}
                            className={cn(
                              "inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                              selected
                                ? "border-gold bg-gold text-primary-foreground"
                                : "border-border bg-surface text-foreground hover:border-gold/40",
                            )}
                          >
                            {swatch ? (
                              <span
                                aria-hidden="true"
                                className="size-4 shrink-0 rounded-full border border-current/25"
                                style={{ backgroundColor: swatch }}
                              />
                            ) : null}
                            <span className="break-words">{value}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>
          ) : null}

          {showingStock ? (
            <section
              aria-label="Rental results"
              className="space-y-3 px-4 py-4 sm:px-6"
            >
              <h2
                ref={resultsHeading}
                tabIndex={-1}
                aria-live="polite"
                className="text-base font-semibold"
              >
                {plural(matchCount, "matching variation")}
              </h2>
              <StockCard product={product} stock={stock} pick={pick} embedded />
            </section>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-6">
          {showingStock ? (
            <>
              <button
                type="button"
                className={cn(ghostButtonClass, "min-h-11")}
                onClick={onClose}
              >
                Done
              </button>
              {cart.count > 0 ? (
                <Link
                  href="/book"
                  className={cn(goldButtonClass, "min-h-11")}
                  onClick={onClose}
                >
                  <ShoppingBag aria-hidden="true" className="size-4" /> Checkout
                  ({cart.count})
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className={cn(ghostButtonClass, "min-h-11")}
                onClick={() => {
                  setPick({});
                  setSearched(true);
                }}
              >
                Show all
              </button>
              <button
                type="button"
                className={cn(goldButtonClass, "min-h-11")}
                onClick={() => setSearched(true)}
              >
                <Search aria-hidden="true" className="size-4" /> Search ·{" "}
                {matchCount === 1 ? "1 match" : `${matchCount} matches`}
              </button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
