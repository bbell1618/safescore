import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/portal/safety",
        destination: "/portal",
        permanent: false,
      },
      {
        source: "/portal/plan",
        destination: "/portal/playbook",
        permanent: false,
      },
      {
        source: "/portal/monitoring",
        destination: "/portal/activity",
        permanent: false,
      },
      {
        source: "/portal/cases",
        destination: "/portal/activity",
        permanent: false,
      },
      {
        source: "/portal/requests",
        destination: "/portal/documents",
        permanent: false,
      },
      {
        source: "/portal/reports",
        destination: "/portal/documents",
        permanent: false,
      },
      {
        source: "/portal/profile",
        destination: "/portal/account",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
