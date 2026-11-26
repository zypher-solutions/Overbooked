"use client";

import { useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Modal, ghostButtonClass, goldButtonClass } from "@/components/shop/ui";

const LONGEST = 1400; // the saved picture's longest side, in pixels (the upload then shrinks it further)

/** cuts the chosen frame out of the picture; a PNG stays a PNG so a logo keeps its see-through background */
async function cropArea(src: string, area: Area, png: boolean): Promise<File> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, LONGEST / Math.max(area.width, area.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const ctx = canvas.getContext("2d")!;
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); } // JPEG has no see-through: white, not black
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  const type = png ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.92));
  if (!blob) throw new Error("The photo could not be cropped.");
  return new File([blob], png ? "photo.png" : "photo.jpg", { type });
}

export interface CropShape { label: string; aspect: number }

/**
 * Pick which part of a photo to keep, as when setting a profile picture: drag to move, slider / wheel / pinch to zoom.
 * Square by default (product photos are shown square); `shapes` lets the user choose (a logo can be wide).
 * `fitWhole` lets them zoom out past the edges, so a whole logo fits with empty space around it.
 */
export function PhotoCropper({ file, onCancel, onDone, title = "Adjust photo", shapes, fitWhole = false }: {
  file: File | null; onCancel: () => void; onDone: (cropped: File) => void; title?: string; shapes?: CropShape[]; fitWhole?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(shapes?.[0].aspect ?? 1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [boxW, setBoxW] = useState(0);
  const minZoom = fitWhole ? 0.3 : 1;
  // zoomed out past the edges the frame would shrink to the photo; keep it a steady size instead
  const cropSize = fitWhole && boxW ? { width: boxW * 0.9, height: (boxW * 0.9) / aspect } : undefined;

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url); setCrop({ x: 0, y: 0 }); setZoom(fitWhole ? 0.85 : 1); setArea(null);
    return () => URL.revokeObjectURL(url);
  }, [file, fitWhole]);

  const use = async () => {
    if (!src || !area || !file) return;
    setBusy(true);
    try { onDone(await cropArea(src, area, file.type === "image/png")); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The photo could not be cropped."); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={!!file} onClose={onCancel} title={title} description="Drag to move it. Zoom to fit what should show."
      footer={<>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
        <button type="button" className={goldButtonClass} disabled={!area || busy} onClick={() => void use()}>{busy ? "Saving..." : "Use photo"}</button>
      </>}>
      {shapes && shapes.length > 1 ? (
        <div className="mb-3 flex gap-2" role="group" aria-label="Shape">
          {shapes.map((s) => (
            <button key={s.label} type="button" aria-pressed={s.aspect === aspect} onClick={() => setAspect(s.aspect)}
              className={cn("rounded-full border px-3 py-1 text-xs", s.aspect === aspect ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-accent/40")}>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={(el) => { if (el) setBoxW(el.clientWidth); }} className={cn("relative aspect-square w-full overflow-hidden rounded-lg", fitWhole ? "bg-muted" : "bg-black")}>
        {src ? <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} cropSize={cropSize} minZoom={minZoom} maxZoom={4} showGrid={false}
          objectFit={fitWhole ? "contain" : "cover"} restrictPosition={!fitWhole}
          classes={{ mediaClassName: "max-w-none" }} // Tailwind's img max-width:100% would squash wide photos
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, px) => setArea(px)} /> : null}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Slider aria-label="Zoom" min={minZoom} max={4} step={0.01} value={[zoom]} onValueChange={([z]) => setZoom(z)} />
        <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </Modal>
  );
}
