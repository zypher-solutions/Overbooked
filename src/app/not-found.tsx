export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">That page does not exist or has moved.</p>
      <a href="/" className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-black hover:bg-gold/90">
        Back to Overbooked
      </a>
    </div>
  );
}
