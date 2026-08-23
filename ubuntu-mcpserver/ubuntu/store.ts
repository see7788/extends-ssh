import { execFile } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import ubuntu from "ubuntu-lib/index.ts";
import { z } from "zod";

const projectPathValidator = z.string().trim().min(1).refine(isAbsolute, { message: "projectPath must be an absolute path" });
const projectReadValidator = z.object({ projectPath: projectPathValidator }).strict();
const dependenciesInstallValidator = projectReadValidator;
const importsEnsureValidator = z.object({ projectPath: projectPathValidator, sourceFilePath: z.string().trim().min(1).refine(isAbsolute, { message: "sourceFilePath must be an absolute path" }) }).strict();
const stateValidator = z.object({ port: z.number().int().min(1).max(65_535) }).strict();
const dependencyMapValidator = z.record(z.string(), z.string());
const projectPackageValidator = z.object({ name: z.string().trim().min(1), tpltype: z.enum(["node-application", "hono-application", "electron-vite-application"]).optional(), dependencies: dependencyMapValidator.optional(), devDependencies: dependencyMapValidator.optional(), optionalDependencies: dependencyMapValidator.optional(), peerDependencies: dependencyMapValidator.optional(), workspaces: z.unknown().optional() }).passthrough();
const projectProfiles = ["node", "hono", "electron-vite"] as const;
type ProjectProfile = typeof projectProfiles[number];
type UbuntuProjectRead = {
  project: { name: string; path: string; profile: ProjectProfile };
  config: { path: string; uri: string };
  blackbox: { resourceName: string; path: string; uri: string; instruction: string };
  usage: { importPath: string; importStatement: string; expressions: readonly string[] };
  constraints: string[];
};
const dependencyPatch = { devDependencies: { "ubuntu-lib": "workspace:*", vite: "^8.0.11" } } as const;
const ubuntuImport = 'import ubuntu from "ubuntu-lib/index.ts";';
const applicableExpressions = { node: ["ubuntu.vite.pro.nodejs()"], hono: ["ubuntu.vite.dev.forward()", "ubuntu.vite.pro.nodejs()"], "electron-vite": ["ubuntu.vite.dev.forward()"] } as const satisfies Record<ProjectProfile, readonly string[]>;
const blackboxPath = createRequire(import.meta.url).resolve("ubuntu-lib/README.md");
const blackboxUri = pathToFileURL(blackboxPath).href;
type ActionResult<T extends object> = { body: T; status?: 400 };
const missingPath = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR");
const existingFile = async (path: string): Promise<boolean> => { try { return (await stat(path)).isFile(); } catch (error) { if (missingPath(error)) return false; throw error; } };
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const pnpmInstall = async (projectPath: string): Promise<void> => new Promise((resolvePromise, rejectPromise) => {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", "install"] : ["install"];
  execFile(executable, args, { cwd: projectPath, encoding: "utf8", maxBuffer: 5 * 1024 * 1024, timeout: 120_000, windowsHide: true }, error => error ? rejectPromise(new Error(`pnpm install failed: ${error.message}`)) : resolvePromise());
});
const sourceInsideProject = (projectPath: string, sourceFilePath: string): boolean => { const value = relative(projectPath, sourceFilePath); return value.length > 0 && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value); };
const importEnsure = async (sourceFilePath: string): Promise<boolean> => {
  const original = await readFile(sourceFilePath, "utf8");
  if (original.includes(ubuntuImport)) return false;
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? original.slice(1) : original;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const shebangEnd = source.startsWith("#!") ? source.indexOf("\n") + 1 : 0;
  await writeFile(sourceFilePath, `${bom}${source.slice(0, shebangEnd)}${ubuntuImport}${newline}${source.slice(shebangEnd)}`, "utf8");
  return true;
};
const canonicalProjectPath = async (projectPath: string): Promise<string> => { let canonicalPath: string; try { canonicalPath = await realpath(projectPath); } catch (error) { if (missingPath(error)) throw new Error(`projectPath does not exist: ${projectPath}`); throw error; } if (!(await stat(canonicalPath)).isDirectory()) throw new Error(`projectPath must identify a directory: ${canonicalPath}`); return canonicalPath; };
const projectProfileDetect = (tpltype: z.infer<typeof projectPackageValidator>["tpltype"], dependencyNames: ReadonlySet<string>, viteConfigExists: boolean, electronViteConfigExists: boolean): ProjectProfile => {
  if (tpltype === "electron-vite-application") { if (!electronViteConfigExists || viteConfigExists) throw new Error("electron-vite-application requires only electron.vite.config.ts"); if (!dependencyNames.has("electron-vite")) throw new Error("electron.vite.config.ts requires the electron-vite dependency"); return "electron-vite"; }
  if (!viteConfigExists || electronViteConfigExists) throw new Error(`${String(tpltype)} requires only vite.config.ts`);
  if (tpltype === "hono-application") { if (!dependencyNames.has("hono")) throw new Error("hono-application requires the hono dependency"); return "hono"; }
  if (tpltype === "node-application") return "node";
  throw new Error(`Unsupported tpltype for Ubuntu Vite: ${String(tpltype)}`);
};

type UbuntuSlice = {
  ubuntuActions: {
    dependenciesInstall(input: z.output<typeof dependenciesInstallValidator>): Promise<ActionResult<Record<string, unknown>>>;
    importsEnsure(input: z.output<typeof importsEnsureValidator>): Promise<ActionResult<Record<string, unknown>>>;
    projectRead(input: z.output<typeof projectReadValidator>): Promise<UbuntuProjectRead>;
    readme(uri?: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>;
    state(input: z.output<typeof stateValidator>): ReturnType<typeof ubuntu.vite.state>;
  };
};

const s: ImmerStateCreator<UbuntuSlice> = () => ({
  ubuntuActions: {
    async dependenciesInstall(input) {
      try {
        const projectPath = await canonicalProjectPath(dependenciesInstallValidator.parse(input).projectPath);
        if (await existingFile(join(projectPath, "pnpm-workspace.yaml"))) throw new Error(`projectPath must identify a concrete package, not a pnpm workspace root: ${projectPath}`);
        const packageJsonPath = join(projectPath, "package.json");
        if (!(await existingFile(packageJsonPath))) throw new Error(`package.json is required: ${packageJsonPath}`);
        const packageJson = projectPackageValidator.parse(JSON.parse(await readFile(packageJsonPath, "utf8")));
        const next = { ...packageJson, devDependencies: { ...(packageJson.devDependencies ?? {}), ...dependencyPatch.devDependencies } };
        const changed = JSON.stringify(next) !== JSON.stringify(packageJson);
        if (changed) await writeFile(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await pnpmInstall(projectPath);
        return { body: { changed, installed: dependencyPatch, packageJsonPath, projectPath } };
      } catch (error) { return { body: { error: errorMessage(error) }, status: 400 }; }
    },
    async importsEnsure(input) {
      try {
        const value = importsEnsureValidator.parse(input);
        const projectPath = await canonicalProjectPath(value.projectPath);
        const sourceFilePath = await realpath(resolve(value.sourceFilePath));
        if (!sourceInsideProject(projectPath, sourceFilePath)) throw new Error(`sourceFilePath must resolve inside projectPath: ${sourceFilePath}`);
        if (!(await stat(sourceFilePath)).isFile() || extname(sourceFilePath).toLowerCase() !== ".ts") throw new Error(`sourceFilePath must be an existing .ts file: ${sourceFilePath}`);
        if (sourceFilePath.toLowerCase().endsWith(".d.ts")) throw new Error(`Declaration files are not supported: ${sourceFilePath}`);
        return { body: { added: await importEnsure(sourceFilePath) ? [ubuntuImport] : [], projectPath, sourceFilePath } };
      } catch (error) { return { body: { error: errorMessage(error) }, status: 400 }; }
    },
    async projectRead(input) {
      const { projectPath } = projectReadValidator.parse(input);
      const canonicalPath = await canonicalProjectPath(projectPath);
      const packagePath = join(canonicalPath, "package.json");
      const viteConfigPath = join(canonicalPath, "vite.config.ts");
      const electronViteConfigPath = join(canonicalPath, "electron.vite.config.ts");
      const [packageExists, viteConfigExists, electronViteConfigExists, pnpmWorkspaceExists, pnpmWorkspaceYmlExists] = await Promise.all([existingFile(packagePath), existingFile(viteConfigPath), existingFile(electronViteConfigPath), existingFile(join(canonicalPath, "pnpm-workspace.yaml")), existingFile(join(canonicalPath, "pnpm-workspace.yml"))]);
      if (!packageExists) throw new Error(`Concrete package is missing package.json: ${canonicalPath}`);
      let packageJson: z.infer<typeof projectPackageValidator>;
      try { packageJson = projectPackageValidator.parse(JSON.parse(await readFile(packagePath, "utf8"))); } catch (error) { throw new Error(`Invalid concrete package.json: ${packagePath}`, { cause: error }); }
      if (packageJson.name.startsWith("extends-") || packageJson.name.endsWith("-lib")) throw new Error(`Ubuntu Vite helpers apply only to application packages: ${packageJson.name}`);
      if (packageJson.workspaces !== undefined || pnpmWorkspaceExists || pnpmWorkspaceYmlExists) throw new Error(`Workspace roots are not concrete packages: ${canonicalPath}`);
      const dependencyNames = new Set<string>();
      for (const dependencies of [packageJson.dependencies, packageJson.devDependencies, packageJson.optionalDependencies, packageJson.peerDependencies]) for (const name of Object.keys(dependencies ?? {})) dependencyNames.add(name);
      if (!dependencyNames.has("ubuntu-lib")) throw new Error(`The concrete package must declare ubuntu-lib: ${packagePath}`);
      const profile = projectProfileDetect(packageJson.tpltype, dependencyNames, viteConfigExists, electronViteConfigExists);
      const configPath = profile === "electron-vite" ? electronViteConfigPath : viteConfigPath;
      return { project: { name: packageJson.name, path: canonicalPath, profile }, config: { path: configPath, uri: pathToFileURL(configPath).href }, blackbox: { resourceName: "vite.readme", path: blackboxPath, uri: blackboxUri, instruction: "Read the vite.readme MCP resource before composing the public expressions below." }, usage: { importPath: "ubuntu-lib/index.ts", importStatement: "import ubuntu from \"ubuntu-lib/index.ts\";", expressions: applicableExpressions[profile] }, constraints: ["server.port must be a fixed integer from 1 through 65535; do not calculate it dynamically."] };
    },
    async readme(uri) { return { contents: [{ uri: uri ?? blackboxUri, mimeType: "text/markdown", text: await readFile(blackboxPath, "utf8") }] }; },
    state(input) { return ubuntu.vite.state(stateValidator.parse(input).port); },
  },
});

export default s;
export { blackboxUri, dependenciesInstallValidator, importsEnsureValidator, projectReadValidator, stateValidator };
