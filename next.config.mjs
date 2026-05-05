/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
  // NOTE: We deliberately don't set Cross-Origin-Embedder-Policy.
  // COEP is needed only for SharedArrayBuffer / multi-threaded WASM, which is
  // a perf optimization for MediaPipe — not a requirement. Setting it has
  // historically broken Safari + Firebase + cross-origin model fetches in
  // unpredictable ways. Single-threaded MediaPipe works fine.
};

export default nextConfig;
