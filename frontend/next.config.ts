import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',  // For Docker builds
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    // Proxy /api/* to backend in development
    return process.env.NODE_ENV === 'development'
      ? [{ source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL}/api/:path*` }]
      : []
  },
}

export default nextConfig
