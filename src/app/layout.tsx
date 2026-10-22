import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/overbooked/AuthContext";
import "@/styles.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Overbooked — Rental Management",
  description: "Overbooked internal rental management panel for premium clothing rentals across Kerala branches.",
  authors: [{ name: "Overbooked" }],
  openGraph: {
    title: "Overbooked — Rental Management",
    description: "Internal panel for tracking clothing rentals, stock and payments.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                window.addEventListener('error', function(e) {
                  if (e.filename && e.filename.indexOf('chrome-extension://') !== -1) {
                    e.stopImmediatePropagation();
                  }
                }, true);
              }
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>
          {children}
          <Toaster position="top-center" duration={3000} />
        </AuthProvider>
      </body>
    </html>
  );
}
