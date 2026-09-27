/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  ...(process.env.BLOG_STUDIO_E2E_BUILD === "1" ? { distDir: ".next-e2e" } : {}),
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "8080",
        pathname: "/api/files/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "8080",
        pathname: "/api/files/**",
      },
    ],
  },
};

export default nextConfig;
