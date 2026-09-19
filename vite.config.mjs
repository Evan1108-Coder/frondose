import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createLocalApi } from "./server/local-api.mjs";

function rumboLocalApi() {
  return {
    name: "rumbo-local-api",
    configureServer(server) {
      const api = createLocalApi();
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
    fs: {
      deny: ["**/.env", "**/.env.*", "**/*.{crt,pem}", "**/.git/**", "**/.rumbo/**"],
    },
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [rumboLocalApi(), react()],
});
