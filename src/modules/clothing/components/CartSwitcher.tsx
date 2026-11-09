"use client";

import { Check, ChevronDown, Plus, ShoppingBag } from "lucide-react";
import { isoToDisplay } from "@/components/shop/DateInput";
import { ghostButtonClass } from "@/components/shop/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { plural } from "@/lib/shop/format";
import { useShop } from "@/lib/shop/ShopContext";
import { cn } from "@/lib/utils";
import { useCart } from "../cart";
import { readDraftPreview } from "../cart-storage";

export function CartSwitcher({
  activeLabel,
}: {
  activeLabel?: string;
}): React.JSX.Element {
  const cart = useCart();
  const { branches } = useShop();
  const activeDraft = readDraftPreview(cart.draftKey(cart.id));
  const label =
    activeLabel ||
    activeDraft?.customerLabel ||
    activeDraft?.customer?.full_name?.trim() ||
    `Cart ${cart.id}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open carts"
          disabled={!cart.ready}
          className={cn(ghostButtonClass, "min-h-11 min-w-0 gap-2 bg-surface")}
        >
          <ShoppingBag
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="max-w-32 truncate">{label}</span>
          {cart.carts.length > 1 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              ({cart.carts.length})
            </span>
          ) : null}
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>
          Open carts
          <span className="block text-xs font-normal text-muted-foreground">
            Checkout details save in this tab.
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={cart.create} className="min-h-10">
          <Plus aria-hidden="true" /> New cart
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="max-h-72 overflow-y-auto">
          {[...cart.carts].reverse().map((entry) => {
            const draft = readDraftPreview(cart.draftKey(entry.id));
            const customer =
              entry.id === cart.id
                ? activeLabel ||
                  draft?.customerLabel ||
                  draft?.customer?.full_name?.trim()
                : draft?.customerLabel || draft?.customer?.full_name?.trim();
            const branch = branches.find(
              (candidate) => candidate.id === entry.branchId,
            )?.name;
            const pickup = draft?.start?.slice(0, 10);
            const returns = draft?.end?.slice(0, 10);
            const dates =
              pickup && returns
                ? `${isoToDisplay(pickup)} – ${isoToDisplay(returns)}`
                : null;
            const count = entry.lines.reduce((sum, line) => sum + line.qty, 0);
            const active = entry.id === cart.id;
            return (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => cart.activate(entry.id)}
                className="items-start px-2 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">
                    {customer || `Cart ${entry.id}`}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {[
                      customer ? `Cart ${entry.id}` : "",
                      plural(count, "item"),
                      branch,
                      dates,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {active ? (
                  <>
                    <Check className="mt-0.5 text-gold" aria-hidden="true" />
                    <span className="sr-only">Active cart</span>
                  </>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
