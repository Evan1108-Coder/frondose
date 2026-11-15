import { defineConfig } from "vite";
import { fileURLToPath } from 'node:url';
import react from "@vitejs/plugin-react";
import { createLocalApi } from "./server/local-api.mjs";
import { interfaceLanguageSourcePlugin } from './scripts/interface-language-transform.mjs';
import { fieldDefaultsSourcePlugin } from './scripts/field-defaults-transform.mjs';
import { frondoseEnvironment } from './server/brand-config.mjs';
import { pdfAssetsPlugin } from './scripts/pdf-assets-plugin.mjs';

function frondoseLocalApi() {
  return {
    name: "rumbo-local-api",
    configureServer(server) {
      // Test previews must opt into an isolated directory; never seed live data.
      const env = frondoseEnvironment(process.env);
      const api = createLocalApi({ productMode: 'local', dataDir: env.FRONDOSE_DATA_DIR || undefined, seedMode: env.FRONDOSE_DATA_DIR && env.FRONDOSE_SEED_MODE === 'demo' ? 'demo' : 'clean' });
      server.middlewares.use(api.middleware);
      server.httpServer?.once("close", () => api.close());
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    fs: {
      deny: ["**/.env", "**/.env.*", "**/*.{crt,pem}", "**/.git/**", "**/.rumbo/**", "**/.talvori/**", "**/.frondose/**"],
    },
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [frondoseLocalApi(), fieldDefaultsSourcePlugin(fileURLToPath(new URL('.', import.meta.url))), interfaceLanguageSourcePlugin(), react(), pdfAssetsPlugin()],
});
