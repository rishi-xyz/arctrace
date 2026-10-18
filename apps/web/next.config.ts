import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The crypto and watermark packages use browser APIs and are loaded by client components.
  transpilePackages: ['@arctrace/crypto', '@arctrace/shared', '@arctrace/watermark'],
  async rewrites() {
    return [{ source: '/s3/:path*', destination: `${process.env.ARCTRACE_S3_PROXY_URL ?? 'http://localhost:9000'}/:path*` }];
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
