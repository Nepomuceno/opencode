import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// CES fork: every build appends `-ces3` to the upstream version so consumers
// can tell a CES build apart from an anomalyco build. Override with
// OPENCODE_CES_SUFFIX="" to disable, or OPENCODE_CES_SUFFIX="foo" to change.
const CES_SUFFIX = (() => {
  const raw = process.env["OPENCODE_CES_SUFFIX"]
  if (raw === undefined) return "-ces3"
  if (raw === "") return ""
  return raw.startsWith("-") ? raw : `-${raw}`
})()

const ensureCesSuffix = (v: string) => (CES_SUFFIX && !v.endsWith(CES_SUFFIX) ? `${v}${CES_SUFFIX}` : v)

const VERSION = await (async () => {
  if (env.OPENCODE_VERSION) return ensureCesSuffix(env.OPENCODE_VERSION)
  if (IS_PREVIEW)
    return ensureCesSuffix(`0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`)
  // CES fork: read the upstream version from the opencode package.json instead
  // of hitting the npm registry. The fork doesn't publish to npm and the build
  // environment may not have outbound network access to registry.npmjs.org.
  const pkgPath = path.resolve(import.meta.dir, "../../opencode/package.json")
  const upstreamVersion = (await Bun.file(pkgPath).json()).version as string
  const [major, minor, patch] = upstreamVersion.split(".").map((x: string) => Number(x) || 0)
  const t = env.OPENCODE_BUMP?.toLowerCase()
  if (t === "major") return ensureCesSuffix(`${major + 1}.0.0`)
  if (t === "minor") return ensureCesSuffix(`${major}.${minor + 1}.0`)
  if (t === "patch") return ensureCesSuffix(`${major}.${minor}.${patch + 1}`)
  // No explicit bump: keep upstream's version and just tag it as a CES build.
  return ensureCesSuffix(upstreamVersion)
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))
