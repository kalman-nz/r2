import { realpathSync } from "node:fs";
import { mergeConfig, searchForWorkspaceRoot } from "vite";
import config from "./vite.config.ts";

export default mergeConfig(config, {
  cacheDir: ".crew-feature-vite-cache",
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync("node_modules"), realpathSync("../node_modules")] },
  },
});
