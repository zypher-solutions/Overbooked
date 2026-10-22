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

// Replaces native confirm(): `message` is the same text the old confirm() showed.
export function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
}: {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}) {
  // Callers clear their target on close; keep the text so it does not flash "undefined" during the fade-out.
  const shown = useRef(message);
  if (open) shown.current = message;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Please confirm</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{shown.current}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
