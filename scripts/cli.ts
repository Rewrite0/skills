#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import metadata from "../meta.json" with { type: "json" };

interface Source {
  url: string;
  branch?: string;
  /** Skill 名称到来源目录的映射；省略时启用全部，空对象表示不启用。 */
  skills?: Record<string, string>;
}

interface Meta {
  sources: Record<string, Source>;
  manual: string[];
}

interface Skill {
  source: string;
  skillPath: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcesRoot = path.join(root, "sources");
const skillsRoot = path.join(root, "skills");
const metaPath = path.join(root, "meta.json");
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function inside(parent: string, relative: string, allowRoot = false): string {
  if (typeof relative !== "string") throw new Error("路径必须是字符串");
  const target = path.resolve(parent, relative);
  const subpath = path.relative(parent, target);
  if ((!allowRoot && !subpath) || subpath === ".." || subpath.startsWith(`..${path.sep}`) || path.isAbsolute(subpath)) {
    throw new Error(`路径越界：${relative}`);
  }
  return target;
}

function sourcePath(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error(`无效来源名称：${name}`);
  return inside(sourcesRoot, name);
}

function loadConfig(): Meta {
  // 为配置文件本身提供静态类型检查，命令内的修改不会影响导入对象。
  const meta: Meta = structuredClone(metadata);
  const names = [...meta.manual];
  const assertKeys = (value: object, allowed: string[], label: string): void => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw new Error(`${label} 存在未知字段：${key}`);
    }
  };
  assertKeys(meta, ["sources", "manual"], "meta.json");
  for (const [name, entry] of Object.entries(meta.sources)) {
    assertKeys(entry, ["url", "branch", "skills"], `来源 ${name}`);
    sourcePath(name);
    if (!entry.url || entry.url.startsWith("-")) throw new Error(`来源 ${name} 的 url 无效`);
    if (entry.branch !== undefined && (!entry.branch || entry.branch.startsWith("-"))) {
      throw new Error(`来源 ${name} 的 branch 无效`);
    }
    if (entry.skills !== undefined) {
      if (!entry.skills || typeof entry.skills !== "object" || Array.isArray(entry.skills)) {
        throw new Error(`来源 ${name} 的 skills 必须是名称到路径的映射`);
      }
      for (const [skillName, skillPath] of Object.entries(entry.skills)) {
        names.push(skillName);
        inside(sourcePath(name), skillPath, true);
      }
    }
  }
  if (new Set(names).size !== names.length) throw new Error("meta.json 中存在重名 Skill");
  for (const name of names) {
    if (!skillNamePattern.test(name)) throw new Error(`无效 Skill 名称：${name}`);
  }
  return meta;
}

function git(args: string[], cwd = root): string {
  const result = spawnSync("git", ["-c", "submodule.recurse=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git 命令失败：git ${args.join(" ")}`);
  return result.stdout.trim();
}

function validateSource(name: string, entry: Source): string {
  const target = sourcePath(name);
  if (!existsSync(path.join(target, ".git"))) {
    throw new Error(`来源缓存缺失或未初始化：${name}；请先运行 pnpm run sources:init`);
  }
  if (git(["rev-parse", "--show-toplevel"], target) !== target) {
    throw new Error(`来源缓存不是独立仓库：${name}`);
  }
  if (git(["remote", "get-url", "origin"], target) !== entry.url) {
    throw new Error(`来源 ${name} 的 origin 与 meta.json 不一致，请移走旧缓存后重新初始化`);
  }
  return target;
}

async function initSource(name: string, entry: Source): Promise<string> {
  const target = sourcePath(name);
  if (existsSync(path.join(target, ".git"))) return validateSource(name, entry);
  if (existsSync(target)) {
    if ((await readdir(target)).length) throw new Error(`来源目录已存在但不是 Git 仓库：${target}`);
    await rm(target, { recursive: true });
  }
  await mkdir(sourcesRoot, { recursive: true });
  git(["clone", "--filter=blob:none", ...(entry.branch ? ["--branch", entry.branch] : []), "--", entry.url, target]);
  console.log(`已克隆来源：${name}`);
  return target;
}

async function updateSource(name: string, entry: Source): Promise<void> {
  const target = await initSource(name, entry);
  if (git(["status", "--porcelain"], target)) throw new Error(`来源 ${name} 有本地修改，请先保存修改后再更新`);
  git(["fetch", "--tags", "--force", "origin"], target);
  if (!entry.branch) git(["remote", "set-head", "origin", "--auto"], target);
  git(["reset", "--hard", `refs/remotes/origin/${entry.branch ?? "HEAD"}`], target);
  console.log(`已更新来源：${name} @ ${git(["rev-parse", "--short", "HEAD"], target)}`);
}

function declaredName(content: string): string | undefined {
  return content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]?.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
}

async function discoverSkills(directory: string, relative = ""): Promise<Record<string, string>> {
  const skills: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    let found: Record<string, string> = {};
    if (entry.isDirectory()) {
      found = await discoverSkills(fullPath, path.join(relative, entry.name));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      const name = declaredName(await readFile(fullPath, "utf8"));
      if (!name) continue;
      if (!skillNamePattern.test(name)) throw new Error(`无效 Skill name：${fullPath}`);
      found[name] = relative || ".";
    }
    for (const [name, skillPath] of Object.entries(found)) {
      if (Object.hasOwn(skills, name)) throw new Error(`来源中存在重名 Skill：${name}`);
      skills[name] = skillPath;
    }
  }
  return skills;
}

async function resolveSkills({ sources, manual }: Meta, requested?: string[], validateCaches = true): Promise<Record<string, Skill>> {
  const skills: Record<string, Skill> = {};
  for (const [source, entry] of Object.entries(sources)) {
    const allSkills = !entry.skills || !Object.keys(entry.skills).length;
    if (requested?.length) {
      if (!allSkills && !requested.some((name) => Object.hasOwn(entry.skills!, name))) continue;
      if (allSkills && !existsSync(path.join(sourcePath(source), ".git"))) continue;
    }
    const target = validateCaches || allSkills ? validateSource(source, entry) : sourcePath(source);
    const selected: Record<string, string> = allSkills ? await discoverSkills(target) : entry.skills!;
    if (allSkills && !Object.keys(selected).length) {
      throw new Error(`全量来源 ${source} 未找到 Skill，已停止同步以保留发布内容`);
    }
    for (const [name, skillPath] of Object.entries(selected)) {
      if (manual.includes(name) || Object.hasOwn(skills, name)) throw new Error(`来源间存在重名 Skill：${name}`);
      skills[name] = { source, skillPath };
    }
  }
  return skills;
}

async function syncSkills(meta: Meta, requested: string[] = [], update = false): Promise<void> {
  if (update) {
    const selected = requested.length ? await resolveSkills(meta, requested, false) : undefined;
    if (selected) {
      for (const name of requested) {
        if (!Object.hasOwn(selected, name)) throw new Error(`没有找到外部 Skill 配置：${name}；请初始化来源或运行全量更新`);
      }
    }
    for (const [name, entry] of Object.entries(meta.sources)) {
      if (entry.skills && !Object.keys(entry.skills).length) continue;
      if (!selected || requested.some((skill) => selected[skill]?.source === name)) {
        await updateSource(name, entry);
      }
    }
  }
  const skills = await resolveSkills(meta, requested);
  const names = requested.length ? [...new Set(requested)] : Object.keys(skills);
  const copies = names.map((name) => {
    const skill = skills[name];
    if (!skill) throw new Error(`没有找到外部 Skill 配置：${name}`);
    return { name, source: inside(sourcePath(skill.source), skill.skillPath, true), destination: inside(skillsRoot, name) };
  });
  // 检查所有输入后再修改发布目录，缺失缓存时保留现有内容。
  for (const { name, source } of [
    ...meta.manual.map((name) => ({ name, source: path.join(skillsRoot, name) })),
    ...copies,
  ]) {
    const info = await stat(path.join(source, "SKILL.md")).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`${name} 缺少 SKILL.md：${source}；请先运行 pnpm run sources:init`);
  }
  if ((await lstat(skillsRoot).catch(() => undefined))?.isSymbolicLink()) {
    throw new Error("skills/ 不能是软链接");
  }
  await mkdir(skillsRoot, { recursive: true });
  const staging = await mkdtemp(path.join(skillsRoot, ".sync-"));
  try {
    // 所有复制成功后再替换或清理，坏链接等复制错误不会破坏现有发布内容。
    for (const { name, source } of copies) {
      const sourceRoot = await realpath(source);
      const skill = skills[name]!;
      const cacheRoot = await realpath(sourcePath(skill.source));
      inside(cacheRoot, path.relative(cacheRoot, sourceRoot), true);
      await cp(source, path.join(staging, name), {
        recursive: true,
        force: true,
        dereference: true,
        filter: async (file) => {
          if ([".git", "node_modules"].includes(path.basename(file))) return false;
          inside(sourceRoot, path.relative(sourceRoot, await realpath(file)), true);
          return true;
        },
      });
    }
    for (const { name, destination } of copies) {
      await rm(destination, { recursive: true, force: true });
      await rename(path.join(staging, name), destination);
      console.log(`已同步 ${name} -> skills/${name}`);
    }
    if (!requested.length) {
      const expected = new Set([...meta.manual, ...Object.keys(skills)]);
      for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && !expected.has(entry.name)) {
          await rm(path.join(skillsRoot, entry.name), { recursive: true, force: true });
          console.log(`已移除不再管理的 Skill：skills/${entry.name}`);
        }
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function addSource(meta: Meta, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { branch: { type: "string" }, skills: { type: "string" } },
  });
  const [url] = positionals;
  if (!url || positionals.length !== 1) throw new Error("用法：pnpm run sources:add <url> [--branch <branch>] [--skills <a,b>]");
  const parts = url.replace(/\/$/, "").replace(/\.git$/, "").split(/[/:]/).filter(Boolean);
  const name = `${parts.at(-2)}-${parts.at(-1)}`;
  if (parts.length < 2) throw new Error(`无法从仓库地址推断来源名称：${url}`);
  const destination = sourcePath(name);
  if (Object.hasOwn(meta.sources, name)) throw new Error(`来源已存在：${name}`);
  if (existsSync(destination)) validateSource(name, { url });
  const requested = values.skills?.split(",").map((name) => name.trim()).filter(Boolean);
  if (values.skills !== undefined && !requested?.length) throw new Error("--skills 后需要提供 Skill 名称");
  if (values.branch !== undefined && !values.branch) throw new Error("--branch 后需要提供分支名");
  const entry: Source = { url, ...(values.branch ? { branch: values.branch } : {}) };
  await initSource(name, entry);
  const discovered = await discoverSkills(destination);
  const names = requested ?? Object.keys(discovered);
  if (!names.length) throw new Error(`来源仓库中没有找到 Skill：${name}`);
  const existing = new Set([
    ...meta.manual,
    ...Object.values(meta.sources).flatMap((source) => Object.keys(source.skills ?? {})),
  ]);
  for (const skill of names) {
    if (!Object.hasOwn(discovered, skill)) throw new Error(`没有找到指定 Skill：${skill}`);
    if (existing.has(skill) || existsSync(path.join(skillsRoot, skill))) throw new Error(`Skill 已存在：${skill}`);
  }
  if (requested) entry.skills = Object.fromEntries(names.map((skill) => [skill, discovered[skill]!]));
  const candidate: Meta = { ...meta, sources: { ...meta.sources, [name]: entry } };
  await resolveSkills(candidate, names);
  await syncSkills(candidate, names);
  await writeFile(metaPath, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(`已添加来源 ${name}，启用 ${names.length} 个 Skill`);
}

async function checkSkills({ sources, manual }: Meta): Promise<void> {
  const entries = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  if (!entries.length) throw new Error("skills/ 中没有找到 Skill");
  const expected = new Set([...manual, ...Object.values(sources).flatMap((entry) => entry.skills && Object.keys(entry.skills).length ? Object.keys(entry.skills) : [])]);
  // 全量来源在同步时扫描；离线校验只检查发布内容及显式选择。
  const hasAllSource = Object.values(sources).some((entry) => !entry.skills || !Object.keys(entry.skills).length);
  const errors: string[] = [];
  for (const name of expected) {
    if (!entries.includes(name)) errors.push(`${name}: 未同步到 skills/`);
  }
  for (const name of entries) {
    if (!hasAllSource && !expected.has(name)) errors.push(`${name}: skills/ 中存在未管理的 Skill`);
    try {
      const declared = declaredName(await readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8"));
      if (declared !== name) errors.push(`${name}: SKILL.md 的 name 应为 ${name}，实际为 ${declared ?? "空"}`);
    } catch (error) {
      errors.push(`${name}: 缺少有效的 SKILL.md（${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`检查通过：${entries.length} 个 Skills`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(`用法：node scripts/cli.ts <command> [args]
  add <url> [--branch <branch>] [--skills <a,b>]  新增来源并同步
  init [source...]                             初始化来源缓存
  sources-update [source...]                   只更新来源缓存
  sync [skill...]                             从本地缓存同步
  update [skill...]                           更新来源并同步
  check                                       校验发布内容`);
    return;
  }
  if (!["add", "init", "sources-update", "sync", "update", "check"].includes(command)) throw new Error(`未知命令：${command}`);
  if (command !== "add" && args.some((arg) => arg.startsWith("-"))) throw new Error(`不支持的参数：${args.join(" ")}`);
  const meta = loadConfig();
  switch (command) {
    case "add":
      await addSource(meta, args);
      break;
    case "init":
    case "sources-update": {
      const names = args.length ? [...new Set(args)] : Object.keys(meta.sources);
      for (const name of names) {
        if (!Object.hasOwn(meta.sources, name)) throw new Error(`未知来源：${name}`);
      }
      for (const name of names) {
        const entry = meta.sources[name]!;
        if (command === "init") await initSource(name, entry);
        else await updateSource(name, entry);
      }
      break;
    }
    case "sync":
    case "update":
      await syncSkills(meta, args, command === "update");
      break;
    case "check":
      if (args.length) throw new Error("check 不接受额外参数");
      await checkSkills(meta);
      break;
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
