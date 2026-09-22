import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on a native canvas package. Keep both packages external so
  // Vercel's function tracer includes the Linux native binary at runtime.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  async redirects() {
    return [
      {"source":"/portal/activity","destination":"/portal/progress","permanent":false},
      {"source":"/portal/compliance","destination":"/portal/plan","permanent":false},
      {"source":"/console/clients/:id/checklist","destination":"/console/clients/:id/work","permanent":false},
      {"source":"/console/clients/:id/requests","destination":"/console/clients/:id/work#requests","permanent":false},
      {"source":"/console/clients/:id/monitoring","destination":"/console/clients/:id/work#monitoring","permanent":false},
      {"source":"/console/clients/:id/remediation","destination":"/console/clients/:id/plan","permanent":false},
      {"source":"/console/clients/:id/remediation/playbook","destination":"/console/clients/:id/plan#playbook","permanent":false},
      {"source":"/console/clients/:id/compliance","destination":"/console/clients/:id/plan#compliance","permanent":false},
      {"source":"/console/clients/:id/reports","destination":"/console/clients/:id/account#reports","permanent":false},
      {
        source: "/portal/safety",
        destination: "/portal",
        permanent: false,
      },
      {
        source: "/portal/playbook",
        destination: "/portal/plan",
        permanent: false,
      },
      {
        source: "/portal/monitoring",
        destination: "/portal/progress",
        permanent: false,
      },
      {
        source: "/portal/cases",
        destination: "/portal/progress",
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
