/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // This tree is type-checked in the sandbox that wrote it, against hand-written
  // ambient stubs for next/react/@supabase (the npm registry is blocked there, so
  // the real packages cannot be installed). The stubs model the APIs we call
  // closely but not the full React DOM attribute surface, so the first real build
  // is allowed through. Run `npm install && npm run typecheck` once locally, send
  // back anything it reports, then delete the block below.
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
