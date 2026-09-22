/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Bundling `ws` breaks its bufferutil mask helper, which the Neon driver hits.
    serverComponentsExternalPackages: ['ws', '@neondatabase/serverless', '@prisma/adapter-neon'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
    ],
  },
}

module.exports = nextConfig