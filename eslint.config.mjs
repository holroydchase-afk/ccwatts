// Studio ESLint config (managed: studio-sync overwrites this file; put repo rules in eslint.studio-local.mjs).
// ESLint 9 flat config. Warnings by default so adoption never turns CI red;
// set STUDIO_LINT_STRICT=1 (the lint workflow's `strict` input) to make every finding an error.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const require = createRequire(import.meta.url);

function deps() {
  try {
    const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return new Set([...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}
const has = deps();
const usesReact = has.has('react');
const usesNative = has.has('react-native') || has.has('expo');
const strict = process.env.STUDIO_LINT_STRICT === '1';
const level = strict ? 'error' : 'warn';

// Every rule a preset turns on is moved to `level`; "off" stays off.
function leveled(configs) {
  return configs.map((c) => {
    if (!c.rules) return c;
    const rules = {};
    for (const [name, v] of Object.entries(c.rules)) {
      const sev = Array.isArray(v) ? v[0] : v;
      const off = sev === 'off' || sev === 0;
      rules[name] = off ? v : Array.isArray(v) ? [level, ...v.slice(1)] : level;
    }
    return { ...c, rules };
  });
}

const config = [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.expo/**',
      '**/ios/**', '**/android/**', '**/.next/**', '**/*.min.js',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: level } },
  ...leveled([js.configs.recommended]),
  ...leveled(tseslint.configs.recommended.map((c) => ({ ...c, files: c.files ?? ['**/*.{ts,tsx,mts,cts}'] }))),
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
];

// Empty catch blocks and underscore-named unused values are deliberate, so they stay quiet.
const unused = { caughtErrors: 'none', ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' };
config.push(
  { rules: { 'no-empty': [level, { allowEmptyCatch: true }] } },
  { files: ['**/*.{js,mjs,cjs,jsx}'], rules: { 'no-unused-vars': [level, unused] } },
  { files: ['**/*.{ts,tsx,mts,cts}'], rules: { '@typescript-eslint/no-unused-vars': [level, unused] } },
);

if (usesReact) {
  config.push(...leveled([{ ...reactHooks.configs.flat.recommended, files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'] }]));
}
if (usesNative) {
  const rn = require('eslint-plugin-react-native');
  config.push({
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-native': rn },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'react-native/no-unused-styles': level,
      'react-native/no-inline-styles': level,
      'react-native/no-color-literals': level,
      'react-native/split-platform-components': level,
      'react-native/no-single-element-style-arrays': level,
    },
  });
}

// Optional repo-local overrides, read from the directory eslint runs in: a flat-config array or a single object, appended last.
try {
  const local = (await import(pathToFileURL(path.resolve(process.cwd(), 'eslint.studio-local.mjs')).href)).default;
  config.push(...(Array.isArray(local) ? local : [local]));
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}

export default config;
