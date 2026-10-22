"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page hit an unexpected error. Your saved data is safe. Try again, or reload the page.
      </p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-black hover:bg-gold/90">
          Try again
        </button>
        <button onClick={() => window.location.reload()} className="rounded-md border border-border px-4 py-2 text-sm font-medium">
          Reload page
        </button>
      </div>
    </div>
  );
}
