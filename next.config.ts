import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/chart/:id.png',
        destination: 'https://quickchart.io/chart/render/:id',
      },
    ];
  },
};

export default nextConfig;
