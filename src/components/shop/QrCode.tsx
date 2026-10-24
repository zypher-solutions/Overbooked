"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

// A QR code as an SVG (sharp at any print size). Medium error correction survives a scratched sticker.
export function QrCode({ text, size = 96, className }: { text: string; size?: number; className?: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { path: d, count: n };
  }, [text]);
  return (
    <svg viewBox={`-1 -1 ${count + 2} ${count + 2}`} width={size} height={size} className={className} role="img" aria-label={`QR code ${text}`}
      shapeRendering="crispEdges">
      <rect x={-1} y={-1} width={count + 2} height={count + 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
