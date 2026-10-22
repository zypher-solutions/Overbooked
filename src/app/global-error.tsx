"use client";

// Replaces the root layout when it crashes, so it cannot rely on the app's CSS or fonts.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <div>
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error. Try again, or reload the page.</p>
          <button onClick={reset} style={{ marginRight: 12, padding: "8px 16px" }}>Try again</button>
          <button onClick={() => window.location.reload()} style={{ padding: "8px 16px" }}>Reload page</button>
        </div>
      </body>
    </html>
  );
}
