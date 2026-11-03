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
    background_color: "#F4F8F5",
    theme_color: "#F4F8F5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
