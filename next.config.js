/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Allow images from any Supabase project storage URL
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