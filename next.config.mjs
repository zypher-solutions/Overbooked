const isDev = process.env.NODE_ENV !== "production";

// The only outside address the app talks to is its own Supabase project (from the environment, never hard-coded).
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321");
const supabaseHttp = supabaseUrl.origin;
const supabaseWs = supabaseUrl.origin.replace(/^http/, "ws");

// Content Security Policy: scripts only from this site (inline ones are what Next.js itself emits), pictures and data only from
// this site and Supabase, no plug-ins, no framing, forms post only to this site.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: ${supabaseHttp}`,
  `connect-src 'self' ${supabaseHttp} ${supabaseWs}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @react-pdf/renderer requires canvas which is not available server-side
  serverExternalPackages: ["canvas"],
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: supabaseUrl.protocol.replace(":", ""),
        hostname: supabaseUrl.hostname,
        ...(supabaseUrl.port ? { port: supabaseUrl.port } : {}),
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
