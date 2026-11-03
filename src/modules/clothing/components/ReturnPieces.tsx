"use client";

import { useCallback, useState } from "react";
import { Check, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CameraScanner } from "@/components/overbooked/CameraScanner";
import { ghostButtonClass, inputClass } from "@/components/shop/ui";

// Clothes (TRENDZ): on a return every piece is scanned, typed or ticked as it comes back; the return dialog
// refuses to save until each one is received or marked lost
export function ReturnPieces({ pieces, received, onChange }: {
  pieces: { id: string; code: string }[];
  received: Set<string>;
  onChange: (next: Set<string> | ((s: Set<string>) => Set<string>)) => void;
}) {
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const receive = useCallback((text: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return;
    const p = pieces.find((x) => x.code.toLowerCase() === t);
    if (!p) { toast.error(`${text.trim()} is not on this booking.`); return; }
    onChange((s) => new Set(s).add(p.id));
    toast.success(`${p.code} received`);
    setCode("");
  }, [pieces, onChange]);
  const onCameraScan = useCallback((text: string) => { setCamera(false); receive(text); }, [receive]);
  const onCameraError = useCallback(() => { setCamera(false); toast.error("Could not open the camera. Type the code instead."); }, []);

  return (
    <div className="rounded-lg border border-gold/30 bg-gold/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gold">Pieces received ({received.size} of {pieces.length})</p>
        <button type="button" className="text-xs text-gold hover:underline" onClick={() => onChange(new Set(pieces.map((p) => p.id)))}>All received</button>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); receive(code); }}>
        <input className={cn(inputClass, "flex-1")} placeholder="Scan or type the piece code" aria-label="Piece code received" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className={ghostButtonClass}>Received</button>
        <button type="button" className={ghostButtonClass} aria-label="Scan with the camera" onClick={() => setCamera((c) => !c)}><ScanLine className="h-4 w-4" /></button>
      </form>
      {camera ? <div className="mt-2"><CameraScanner inline onClose={() => setCamera(false)} onScan={onCameraScan} onError={onCameraError} /></div> : null}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {pieces.map((p) => {
          const on = received.has(p.id);
          return (
            <li key={p.id}>
              <button type="button" aria-pressed={on} onClick={() => onChange((s) => { const n = new Set(s); if (on) n.delete(p.id); else n.add(p.id); return n; })}
                className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", on ? "border-emerald/50 bg-emerald/10 text-emerald" : "border-border text-muted-foreground")}>
                {on ? <Check className="h-3.5 w-3.5" /> : null}<span className="font-mono">{p.code}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
