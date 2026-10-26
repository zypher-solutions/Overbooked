import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface CameraScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: any) => void;
  onClose: () => void;
  /** shown in place (inside a dialog) instead of over the whole screen */
  inline?: boolean;
}

export function CameraScanner({ onScan, onError, onClose, inline = false }: CameraScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current.stop()
        .then(() => {
          scannerRef.current?.clear();
          onClose();
        })
        .catch((e) => {
          console.error(e);
          onClose();
        });
    } else {
      onClose();
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    // -- MONKEY PATCHES TO SUPPRESS HTML5-QRCODE INTERNAL ERRORS --
    // html5-qrcode poorly handles being unmounted during startup.
    // 1. Suppress AbortError from video.play() when video is removed from DOM.
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      return origPlay.call(this).catch((e: any) => {
        if (e && e.name === 'AbortError') return;
        throw e;
      });
    };

    const readerEl = document.getElementById("reader");
    let origRemoveChild: any = null;
    if (readerEl) {
      // 2. Suppress removeChild errors when it tries to remove uninitialized elements.
      origRemoveChild = readerEl.removeChild.bind(readerEl);
      readerEl.removeChild = function(child: any) {
        try {
          if (child && child instanceof Node && child.parentNode === readerEl) {
            return origRemoveChild(child);
          }
        } catch (e) { /* ignore: scanner may already be stopped */ }
        return child;
      };
    }
    // -------------------------------------------------------------

    const scanner = new Html5Qrcode("reader");
    scannerRef.current = scanner;

    scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      },
      (decodedText) => {
        if (!isMounted) return;
        setIsClosing(true);
        // Stop scanning on success before unmounting
        scanner.stop().then(() => {
          scanner.clear();
          onScan(decodedText);
        }).catch((e) => {
          console.error(e);
          onScan(decodedText);
        });
      },
      (errorMessage) => {
        if (!isMounted) return;
        // html5-qrcode throws an error on every frame that doesn't contain a barcode.
        const msg = String(errorMessage);
        if (
          msg.includes("NotFoundException") || 
          msg.includes("No MultiFormat Readers") ||
          msg.includes("IndexSizeError") ||
          msg.includes("getImageData")
        ) {
          return; // Ignore normal frame-by-frame scanning failures
        }
        if (onError) onError(errorMessage);
      }
    ).then(() => {
      // If the component was unmounted while the camera was starting up
      if (!isMounted) {
        scanner.stop().catch(() => {});
      }
    }).catch((err) => {
      if (!isMounted) return;
      console.error("Camera start failed:", err);
      if (onError) onError(err);
    });

    return () => {
      isMounted = false;
      
      // Best effort if unmounted forcefully
      if (scannerRef.current && scannerRef.current.isScanning) {
         scannerRef.current.stop().catch(() => {});
      }

      // Restore patches
      HTMLMediaElement.prototype.play = origPlay;
      if (readerEl && origRemoveChild) {
        readerEl.removeChild = origRemoveChild;
      }
    };
  }, [onScan, onError]);

  return (
    <div className={inline ? "rounded-xl border border-border bg-surface p-3" : `fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-sm ${isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <div className={inline ? "w-full" : "w-full max-w-md overflow-hidden rounded-2xl bg-surface p-4 shadow-2xl"}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Scan Barcode</h3>
          <button 
            onClick={handleClose}
            className="rounded-full bg-surface-2 p-2 hover:bg-surface-3 transition-colors"
          >
            ✕
          </button>
        </div>
        
        <div className="overflow-hidden rounded-xl bg-black">
          <div id="reader" className="w-full"></div>
        </div>
        
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Point your camera at the barcode or QR code
        </p>
      </div>
    </div>
  );
}
