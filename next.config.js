// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // MUST exactly match the origin you see in your browser’s address bar
    allowedDevOrigins: [
      "https://3000-firebase-tfm-web-1761516009999.cluster-cmxrewsem5htqvkvaud2drgfr4.cloudworkstations.dev",
    ],
  },
};

module.exports = nextConfig;