import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [{
      name: 'copy-bundled-voice-guidance',
      apply: 'build',
      buildStart() {
        const emitDirectory = (directory, outputPrefix) => {
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolute = resolve(directory, entry.name);
            const output = `${outputPrefix}/${entry.name}`;
            if (entry.isDirectory()) emitDirectory(absolute, output);
            else this.emitFile({ type: 'asset', fileName: output, source: readFileSync(absolute) });
          }
        };
        const audioSource = resolve('assets/audio');
        if (existsSync(audioSource)) emitDirectory(audioSource, 'assets/audio');
      }
    }],
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production',
      target: 'es2022'
    },
    define: {
      __SHILP_API_ORIGIN__: JSON.stringify(env.VITE_API_ORIGIN || ''),
      __SHILP_AUTH_MODE__: JSON.stringify(env.VITE_AUTH_MODE || 'demo'),
      __SHILP_RELEASE__: JSON.stringify(env.VITE_RELEASE === 'true')
    },
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts: ['agency-politics-fabric-stylish.trycloudflare.com'],
      // Keep frontend files such as /api-client.js inside Vite. Only actual
      // API routes under /api/ should be forwarded to the local backend.
      proxy: { '/api/': 'http://localhost:8787', '/uploads/': 'http://localhost:8787' }
    }
  };
});
