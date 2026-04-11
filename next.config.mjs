const distDir = process.env.NEXT_DIST_DIR || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
