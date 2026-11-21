/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingIncludes: {
    '/api/ingest': [
      './node_modules/pdf-parse/**/*',
      '../node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
      '../node_modules/pdfjs-dist/**/*',
      './node_modules/@napi-rs/canvas*/**/*',
      '../node_modules/@napi-rs/canvas*/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};
export default nextConfig;
