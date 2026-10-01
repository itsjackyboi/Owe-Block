// Dev-only lint config (the game itself has no build step and no dependencies).
//   npx eslint js tools
const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', localStorage: 'readonly',
  performance: 'readonly', requestAnimationFrame: 'readonly', Image: 'readonly', console: 'readonly', fetch: 'readonly',
  URLSearchParams: 'readonly', AudioContext: 'readonly', webkitAudioContext: 'readonly', Float32Array: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
};

let recommended = {};
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const paths = [process.cwd(), ...(req.resolve.paths('eslint') || [])];
  recommended = req(req.resolve('@eslint/js', { paths })).configs.recommended;
} catch { /* @eslint/js not resolvable: fall back to the handful of rules below */ }

export default [
  { ...recommended, files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser } },
  { files: ['js/**/*.js'], rules: { 'no-unused-vars': ['warn', { args: 'none' }], 'no-undef': 'error', 'no-var': 'error', 'prefer-const': 'warn', eqeqeq: ['warn', 'smart'] } },
  { files: ['tools/**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', window: 'readonly', document: 'readonly', location: 'readonly', URL: 'readonly' } }, rules: { 'no-undef': 'error' } },
];
