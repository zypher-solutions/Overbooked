import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online) return null;
  return (
    <div role="alert" className="mb-4 rounded-md border border-rust/50 bg-rust/10 p-3 text-sm text-rust">
      You are offline. Changes will not be saved until the connection returns.
    </div>
  );
}
