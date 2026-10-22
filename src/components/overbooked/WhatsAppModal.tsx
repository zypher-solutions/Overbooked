import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Booking, Rental } from "@/lib/overbooked/types";
import { balanceOf, inr, waLink, waMessage, fmtDate } from "@/lib/overbooked/utils";
import { goldButtonClass, ghostButtonClass } from "./primitives";
import { 
  CheckCircle2, 
  MessageCircle, 
  ChevronDown, 
  ChevronUp, 
  User, 
  MapPin, 
  Calendar, 
  Layers, 
  ExternalLink 
} from "lucide-react";

function isRental(r: Rental | Booking): r is Rental {
  return "rentDate" in r;
}

export function WhatsAppModal({
  rental,
  onClose,
}: {
  rental: Rental | Booking | null;
  onClose: () => void;
}) {
  const [isMessageExpanded, setIsMessageExpanded] = useState(false);

  if (!rental) return null;
  const message = waMessage(rental);
  const phone = rental.customerPhone || "";

  const isRentalItem = isRental(rental);
  const branchName = isRentalItem
    ? (rental.branch || "Main Branch")
    : (rental.branchName || "Main Branch");
  const pickupDate = isRentalItem
    ? rental.rentDate
    : (rental.items?.[0]?.pickupDate || rental.bookingDate || "");
  const returnDate = isRentalItem
    ? rental.dueDate
    : (rental.items?.[0]?.returnDate || "");
  const itemsCount = rental.items?.length || 0;
  const itemsText = itemsCount === 1 && rental.items?.[0]
    ? rental.items[0].productName 
    : `${itemsCount} item${itemsCount > 1 ? "s" : ""}`;
  const balance = balanceOf(rental);

  return (
    <Dialog open={!!rental} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-strong w-[calc(100vw-24px)] sm:w-full sm:max-w-lg p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
        <DialogTitle className="sr-only">Booking Confirmation</DialogTitle>

        {/* 1. Header with Status & Heading */}
        <div className="flex items-center gap-3 pb-3 border-b border-border/50">
          <div className="w-10 h-10 rounded-full bg-emerald/15 text-emerald flex items-center justify-center shrink-0 border border-emerald/30 shadow-sm shadow-emerald/10">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground truncate">
              Booking Confirmed
            </h2>
            <p className="text-xs text-muted-foreground truncate">
              Saved to system · Ready to notify customer
            </p>
          </div>
        </div>

        {/* 2. Prominent Booking Reference */}
        <div className="flex items-center justify-between rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 shadow-sm shadow-gold/5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reference
          </span>
          <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-gold">
            {rental.token}
          </span>
        </div>

        {/* 3. Customer & Rental Details */}
        <div className="rounded-xl border border-border/60 bg-white/[0.02] p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              <User className="w-3.5 h-3.5 text-gold shrink-0" />
              <span>Customer:</span>
            </div>
            <span className="font-semibold text-foreground text-right truncate">
              {rental.customerName} ({rental.customerPhone})
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              <MapPin className="w-3.5 h-3.5 text-gold shrink-0" />
              <span>Branch:</span>
            </div>
            <span className="font-medium text-foreground text-right truncate">
              {branchName}
            </span>
          </div>

          {(pickupDate || returnDate) && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
                <Calendar className="w-3.5 h-3.5 text-gold shrink-0" />
                <span>Rental Period:</span>
              </div>
              <span className="font-medium text-foreground text-right">
                {fmtDate(pickupDate)} → {fmtDate(returnDate)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              <Layers className="w-3.5 h-3.5 text-gold shrink-0" />
              <span>Items:</span>
            </div>
            <span className="font-medium text-foreground text-right truncate max-w-[240px]">
              {itemsText}
            </span>
          </div>
        </div>

        {/* 4. Financial Summary */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border/60 bg-white/[0.02] p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total</div>
              <div className="font-mono font-semibold text-sm text-foreground mt-0.5">{inr(rental.total || 0)}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-white/[0.02] p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Advance</div>
              <div className="font-mono font-semibold text-sm text-emerald mt-0.5">{inr(rental.advance || 0)}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-white/[0.02] p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Balance</div>
              <div className="font-mono font-semibold text-sm text-gold mt-0.5">{inr(balance)}</div>
            </div>
          </div>
          {rental.securityDeposit ? (
            <div className="flex items-center justify-between text-[11px] px-1 text-muted-foreground">
              <span>Security Deposit:</span>
              <span className="font-mono font-medium text-foreground">{inr(rental.securityDeposit)}</span>
            </div>
          ) : null}
        </div>

        {/* 5. Compact Collapsible WhatsApp Message Preview */}
        <div className="rounded-xl border border-border/60 bg-white/[0.02] overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setIsMessageExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between p-2.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.03] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5 font-medium text-foreground/90">
              <MessageCircle className="w-3.5 h-3.5 text-emerald shrink-0" />
              WhatsApp Message Preview
            </span>
            <span className="text-[11px] text-gold flex items-center gap-1 font-medium">
              {isMessageExpanded ? "Collapse" : "Preview"}
              {isMessageExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </span>
          </button>
          {isMessageExpanded && (
            <div className="p-3 border-t border-border/40 max-h-36 overflow-y-auto whitespace-pre-line text-muted-foreground font-mono text-[11px] leading-relaxed bg-muted/70">
              {message}
            </div>
          )}
        </div>

        {/* 6. Three Clearly Visible Actions */}
        <div className="grid gap-2 pt-1">
          <a
            className={goldButtonClass + " w-full flex items-center justify-center gap-2 py-2.5"}
            href={waLink(phone, message, true)}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            <MessageCircle className="w-4 h-4" />
            Send via WhatsApp App
          </a>
          <a
            className={ghostButtonClass + " w-full flex items-center justify-center gap-2 py-2.5 border border-border/80 hover:bg-white/5"}
            href={waLink(phone, message)}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            <ExternalLink className="w-4 h-4" />
            Send via WhatsApp Web
          </a>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg border border-transparent hover:border-border/60 transition-colors cursor-pointer"
          >
            Skip for now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
