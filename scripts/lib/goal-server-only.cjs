// Standalone trusted server verification: Next's build-time marker has no Node package.
// Does not replace auth, database calls, email guards, or application behavior.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node's CommonJS preload runs before the TypeScript module loader.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'server-only') return {};
  return originalLoad.call(this, name, ...args);
};
