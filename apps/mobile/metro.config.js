const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo so Metro can find hoisted packages
config.watchFolders = [monorepoRoot];

// Tell Metro where to find node_modules (project + monorepo root)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Resolve symlinks so pnpm's .pnpm store works with Metro
config.resolver.unstable_enableSymlinks = true;

// Ensure Metro can resolve packages from the pnpm store
const pnpmStore = path.resolve(monorepoRoot, "node_modules", ".pnpm");
if (fs.existsSync(pnpmStore)) {
  config.resolver.disableHierarchicalLookup = false;
}

module.exports = config;
