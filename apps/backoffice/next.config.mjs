import { recoveryBuildEnv } from './recovery-build.mjs'
/** @type {import('next').NextConfig} */
const nextConfig = {
  env: recoveryBuildEnv(),
  // @hcs/ui ships TypeScript source. Next compiles it.
  transpilePackages: ['@hcs/ui', '@hcs/config'],
}
export default nextConfig
