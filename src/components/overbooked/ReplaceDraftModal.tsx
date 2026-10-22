"use client";

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ReplaceDraftModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ReplaceDraftModal({
  open,
  onConfirm,
  onCancel,
}: ReplaceDraftModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent sheet={false} className="glass-strong w-[calc(100vw-32px)] sm:w-full sm:max-w-md rounded-2xl border-border/80 bg-background/95 p-6 sm:p-7 shadow-2xl shadow-black/80">
        <DialogHeader className="space-y-0 text-left">
          {/* Warning Icon with restrained gold/amber styling */}
          <div className="mb-4 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-xl border border-gold/30 bg-gold/10 text-gold shadow-sm">
            <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-gold" />
          </div>

          <DialogTitle className="font-display text-lg sm:text-xl font-semibold tracking-tight text-foreground">
            Replace Current Draft?
          </DialogTitle>

          <DialogDescription className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
            You have an unfinished booking with items in your cart. Starting a new
            rental will replace the current draft, including its customer details
            and selected units.
          </DialogDescription>
        </DialogHeader>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-border bg-white/[0.04] px-4 py-2.5 text-xs sm:text-sm font-medium text-muted-foreground hover:bg-white/[0.08] hover:text-foreground active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          >
            Keep Current Draft
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg bg-rust hover:bg-rust/90 active:scale-[0.99] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-rust/50 cursor-pointer"
          >
            Replace Draft & Continue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
