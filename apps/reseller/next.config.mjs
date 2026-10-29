/** @type {import('next').NextConfig} */
const nextConfig = {
  // @hcs/ui ships TypeScript source. Next compiles it.
  transpilePackages: ['@hcs/ui', '@hcs/config'],
}
export default nextConfig
