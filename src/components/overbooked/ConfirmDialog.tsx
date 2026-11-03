import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRef } from "react";
import { AlertTriangle, HelpCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: { icon: HelpCircle, ring: "bg-accent text-gold", action: "" },
  warn: { icon: AlertTriangle, ring: "bg-amber/15 text-amber", action: "" },
  danger: { icon: Trash2, ring: "bg-rust/10 text-rust", action: "bg-rust text-white hover:bg-rust/90" },
} as const;

// The app's own "are you sure?" card (never the browser's pop-up). `message` may have several lines; each shows on its own.
export function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  title = "Please confirm",
  tone = "neutral",
}: {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  title?: string;
  tone?: keyof typeof TONES;
}) {
  // Callers clear their target on close; keep the text so it does not flash "undefined" during the fade-out.
  const shown = useRef(message);
  if (open) shown.current = message;
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <AlertDialogHeader className="items-center text-center sm:text-center">
          <span className={cn("mb-1 flex h-14 w-14 items-center justify-center rounded-full", t.ring)}><Icon className="h-7 w-7" aria-hidden="true" /></span>
          <AlertDialogTitle className="font-display text-xl font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line text-base leading-relaxed">{shown.current}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-center">
          <AlertDialogCancel className="min-h-11 rounded-full px-6">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={cn("min-h-11 rounded-full px-6", t.action)}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
