/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
      // Allow Firebase Cloud Workstations / external dev hosts
      allowedDevOrigins: ["http://localhost:3000", "*"]
    }
  };
  
  module.exports = nextConfig;