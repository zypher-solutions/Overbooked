import type { MetadataRoute } from "next";

// Lets a phone "Add to Home screen" Overbooked, so it opens full screen like an app until the native app is ready.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Overbooked",
    short_name: "Overbooked",
    description: "Rental management for rental shops: stock, bookings, returns and payments across branches.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1C1B1A",
    theme_color: "#1C1B1A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
