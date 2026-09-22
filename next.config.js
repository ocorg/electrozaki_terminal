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
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

module.exports = nextConfig