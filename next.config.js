/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    API_URL: process.env.API_URL || 'http://localhost:3001',
    WS_URL: process.env.WS_URL || 'ws://localhost:3001'
  },
  webpack: (config) => {
    config.devtool = 'source-map';
    return config;
  },
}

module.exports = nextConfig