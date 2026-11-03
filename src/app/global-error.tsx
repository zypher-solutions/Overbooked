"use client";

import { dmSans, outfit } from "@/lib/fonts";

// The root error screen has its own document, so it applies the shared font variables directly.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${outfit.variable}`}>
      <body
        style={{
          fontFamily: "var(--font-dm-sans), sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontFamily: "var(--font-outfit), sans-serif" }}>Something went wrong</h1>
          <p>The app hit an unexpected error. Try again, or reload the page.</p>
          <button onClick={reset} style={{ marginRight: 12, padding: "8px 16px" }}>
            Try again
          </button>
          <button onClick={() => window.location.reload()} style={{ padding: "8px 16px" }}>
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
