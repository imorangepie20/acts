import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Evidence uploads (phone photos) go through a Server Action; the attachment service caps files at 10MB.
    serverActions: { bodySizeLimit: "11mb" },
    // proxy.ts runs on those action POSTs and buffers the body up to this cap (default 10MB),
    // silently truncating anything larger, so a 10MB file plus multipart overhead must fit.
    proxyClientMaxBodySize: "11mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
