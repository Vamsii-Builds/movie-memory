import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Postgres driver as a native Node dependency on the server.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
