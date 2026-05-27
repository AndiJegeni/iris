import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Let the example resolve workspace packages directly from source.
  transpilePackages: ['@localagents/react'],
};

export default config;
