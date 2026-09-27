/**
 * setup-vite-env.mjs — Polyfill import.meta.env for tsx in Node.js test runs.
 * Loaded via tsx --import before test files.
 */
// Install a global so all subsequent modules pick it up.
// tsx re-uses module caches, so this must run before any module that uses import.meta.env.
globalThis.__vite_import_meta_env__ = {};
