import BluebirdPromise from "bluebird-lst-c"
import * as path from "path"
import { task, log } from "./util/log"
import { homedir } from "os"
import { spawn, exists, asArray } from "./util/util"
import { BuildMetadata } from "./metadata"

export function installDependencies(appDir: string, electronVersion: string, arch: string = process.arch, additionalArgs: Array<string>): Promise<any> {
  return task(`Installing app dependencies for arch ${arch} to ${appDir}`, spawnNpmProduction(appDir, getGypEnv(electronVersion, arch), additionalArgs))
}

export function getGypEnv(electronVersion: string, arch: string): any {
  const gypHome = path.join(homedir(), ".electron-gyp")
  return Object.assign({}, process.env, {
    npm_config_disturl: "https://atom.io/download/electron",
    npm_config_target: electronVersion,
    npm_config_runtime: "electron",
    npm_config_arch: arch,
    HOME: gypHome,
    USERPROFILE: gypHome,
  })
}

export function computeExtraArgs(options: BuildMetadata) {
  const args = asArray(options.npmArgs)
  if (options.npmSkipBuildFromSource !== true) {
    args.push("--build-from-source")
  }
  return args
}

function spawnNpmProduction(appDir: string, env: any, additionalArgs: Array<string>): Promise<any> {
  let npmExecPath = process.env.npm_execpath || process.env.NPM_CLI_JS
  const npmExecArgs = ["install", "--production"]

  const isYarn = npmExecPath != null || npmExecPath.includes("yarn")
  if (!isYarn) {
    if (process.env.NPM_NO_BIN_LINKS === "true") {
      npmExecArgs.push("--no-bin-links")
    }
    npmExecArgs.push("--cache-min", "999999999")
  }

  if (npmExecPath == null) {
    npmExecPath = getPackageToolPath()
  }
  else {
    npmExecArgs.unshift(npmExecPath)
    npmExecPath = process.env.npm_node_execpath || process.env.NODE_EXE || "node"
  }

  for (let a of additionalArgs) {
    if (!isYarn || a !== "--build-from-source") {
      npmExecArgs.push(a)
    }
  }

  console.log("AAA " + npmExecPath + " " + npmExecArgs.join(" "))
  return spawn(npmExecPath, npmExecArgs, {
    cwd: appDir,
    env: env
  })
}

let readInstalled: any = null
export function dependencies(dir: string, extraneousOnly: boolean, result: Set<string>): Promise<Array<string>> {
  if (readInstalled == null) {
    readInstalled = BluebirdPromise.promisify(require("read-installed"))
  }
  return readInstalled(dir)
    .then((it: any) => flatDependencies(it, result, new Set(), extraneousOnly))
}

function flatDependencies(data: any, result: Set<string>, seen: Set<string>, extraneousOnly: boolean): void {
  const deps = data.dependencies
  if (deps == null) {
    return
  }

  for (let d of Object.keys(deps)) {
    const dep = deps[d]
    if (typeof dep !== "object" || (!extraneousOnly && dep.extraneous) || seen.has(dep)) {
      continue
    }

    if (extraneousOnly === dep.extraneous) {
      seen.add(dep)
      result.add(dep.path)
    }
    else {
      flatDependencies(dep, result, seen, extraneousOnly)
    }
  }
}

function getPackageToolPath() {
  if (process.env.FORCE_YARN === "true") {
    return process.platform === "win32" ? "yarn.cmd" : "yarn"
  }
  else {
    return process.platform === "win32" ? "npm.cmd" : "npm"
  }
}

export async function rebuild(appDir: string, electronVersion: string, arch: string = process.arch, additionalArgs: Array<string>) {
  const deps = new Set<string>()
  await dependencies(appDir, false, deps)
  const nativeDeps = await BluebirdPromise.filter(deps, it => exists(path.join(it, "binding.gyp")), {concurrency: 8})

  if (nativeDeps.length === 0) {
    return
  }

  log(`Rebuilding native production dependencies for arch ${arch}`)

  let execPath = process.env.npm_execpath || process.env.NPM_CLI_JS
  const execArgs = ["run", "install", "--"]

  if (execPath == null) {
    execPath = getPackageToolPath()
  }
  else {
    execArgs.unshift(execPath)
    execPath = process.env.npm_node_execpath || process.env.NODE_EXE || "node"
  }

  const gypHome = path.join(homedir(), ".electron-gyp")
  const env = Object.assign({}, process.env, {
    HOME: gypHome,
    USERPROFILE: gypHome,
  })

  execArgs.push("--disturl=https://atom.io/download/electron")
  execArgs.push(`--target=${electronVersion}`)
  execArgs.push("--runtime=electron")
  execArgs.push(`--arch=${arch}`)
  execArgs.push(...additionalArgs)

  await BluebirdPromise.each(nativeDeps, it => spawn(execPath, execArgs, {cwd: it, env: env}))
}