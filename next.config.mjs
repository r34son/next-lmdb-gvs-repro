export default {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  experimental: { turbopackDetectGlobalVirtualStore: true },
  serverExternalPackages: ['lmdb'],
  outputFileTracingIncludes: {
    '/**/*': [
      `./node_modules/.pnpm/node_modules/@lmdb/lmdb-${process.platform}-${process.arch}/**/*`,
    ],
  },
};
