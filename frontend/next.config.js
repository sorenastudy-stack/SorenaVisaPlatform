const createNextIntlPlugin = require('next-intl/plugin');

// Point next-intl at our server-side i18n config. Default path is
// './src/i18n/request.ts' which is where we put it — no argument needed.
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withNextIntl(nextConfig);
