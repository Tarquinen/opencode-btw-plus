import { expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import path from "node:path"

test.each(["source", "npm"])("%s plugin shares the host's runtime", async (kind) => {
  const root = path.resolve(import.meta.dir, "..")
  await mkdir("/tmp/opencode", { recursive: true })
  const directory = await mkdtemp("/tmp/opencode/btw-runtime-")
  try {
    let plugin = directory
    let entrypoint = path.join(plugin, "tui.tsx")
    if (kind === "npm") {
      // Test the prepack build from a real node_modules path, where source
      // loading behaved differently from a local checkout.
      await run(["npm", "pack", "--pack-destination", directory], root)
      const { name, version } = await Bun.file(path.join(root, "package.json")).json()
      plugin = path.join(directory, "node_modules", name)
      await mkdir(plugin, { recursive: true })
      await run(["tar", "-xzf", path.join(directory, `${name}-${version}.tgz`), "--strip-components=1", "-C", plugin], root)
      const manifest = await Bun.file(path.join(plugin, "package.json")).json()
      entrypoint = path.resolve(plugin, manifest.exports["./tui"])
    } else {
      for (const file of ["package.json", "tui.tsx", "src"]) {
        await cp(path.join(root, file), path.join(plugin, file), { recursive: true })
      }
    }
    const modules = path.join(plugin, "node_modules")
    await mkdir(path.join(modules, "@opencode"), { recursive: true })
    // An isolated Solid copy must not disconnect the plugin from host state.
    await cp(path.join(root, "node_modules/solid-js"), path.join(modules, "solid-js"), { recursive: true })
    for (const dependency of ["@opencode/theme", "string-width"]) {
      await symlink(path.join(root, "node_modules", dependency), path.join(modules, dependency))
    }
    await run([
      process.execPath, "test", "--conditions=browser", "--preload", "@opentui/solid/preload", "test/plugin.test.tsx",
    ], root, { OPENCODE_BTW_TEST_ENTRYPOINT: entrypoint })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)

async function run(command: string[], cwd: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
}
