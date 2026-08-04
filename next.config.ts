import type { NextConfig } from "next";

const scannerPort = process.env.SCANNER_PORT || "8000";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
  ],
  async rewrites() {
    return [
      {
        // Frontend calls /scanner/api/...; FastAPI serves /api/... on :8000
        source: "/scanner/:path*",
        destination: `http://localhost:${scannerPort}/:path*`,
      },
    ];
  },
};

export default nextConfig;
