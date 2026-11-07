/** @type {import('next').NextConfig} */

// Security headers (security review 2026-11-07), like the website's: no page
// of the ERP may be shown inside another site (a hidden frame could make a
// signed-in user click), files are read as what they say they are, links
// leaving the ERP don't carry its addresses, and only the camera is used
// (the barcode scanner).
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
]

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
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

module.exports = nextConfig
