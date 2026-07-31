import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['react'],
  // esbuild treats a leading directive as a plain expression statement and drops
  // it when bundling, so the `'use client'` in src/Iris.tsx never reaches dist.
  // Without it, rendering <Iris /> from a Next.js App Router layout (a Server
  // Component) throws "useEffect only works in Client Components" and the whole
  // page 500s. Re-emit it at the top of every output.
  banner: { js: "'use client';" },
});
