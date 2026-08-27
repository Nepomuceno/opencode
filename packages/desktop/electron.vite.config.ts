import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import * as fs from "node:fs/promises"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

// Resolve the node-pty native package for the TARGET platform, not the build
// host. When cross-building (e.g. Windows installers on an Apple Silicon Mac),
// set RUST_TARGET (e.g. x86_64-pc-windows-msvc) so the bundle imports the
// correct prebuilt binding instead of the host's darwin-arm64 one.
const nodePtyTarget = (() => {
  const rustTarget = process.env.RUST_TARGET
  const map: Record<string, { platform: string; arch: string }> = {
    "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64" },
    "aarch64-pc-windows-msvc": { platform: "win32", arch: "arm64" },
    "x86_64-apple-darwin": { platform: "darwin", arch: "x64" },
    "aarch64-apple-darwin": { platform: "darwin", arch: "arm64" },
    "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64" },
    "aarch64-unknown-linux-gnu": { platform: "linux", arch: "arm64" },
  }
  if (rustTarget && map[rustTarget]) return map[rustTarget]
  return { platform: process.platform, arch: process.arch }
})()

const nodePtyPkg = `@lydell/node-pty-${nodePtyTarget.platform}-${nodePtyTarget.arch}`

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
