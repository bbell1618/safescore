import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/portal/safety",
        destination: "/portal",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
