#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const skillsRoot = path.join(repoRoot, "skills");
const customRoot = path.join(repoRoot, "custom");
const config = JSON.parse(
  await readFile(path.join(repoRoot, "skills.config.json"), "utf8"),
);
const args = process.argv.slice(2);
const update = args.includes("--update") || args.includes("-u");
const requested = args.filter((arg) => !arg.startsWith("-"));
const names = requested.length ? requested : Object.keys(config);

function git(gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`git 命令失败：git ${gitArgs.join(" ")}`);
  }
}

function assertInside(parent, child, label) {
  const relative = path.relative(parent, child);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label}路径越界：${child}`);
  }
}

async function listDirectories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function validateSkill(directory, name) {
  const skillFile = path.join(directory, "SKILL.md");
  const info = await stat(skillFile).catch(() => undefined);
  if (!info?.isFile()) {
    throw new Error(`${name} 缺少 SKILL.md：${directory}`);
  }
}

const customNames = await listDirectories(customRoot);
const duplicateNames = customNames.filter((name) => config[name]);
if (duplicateNames.length) {
  throw new Error(`custom/ 与 skills.config.json 存在重名 Skill：${duplicateNames.join(", ")}`);
}
for (const name of customNames) {
  await validateSkill(path.join(customRoot, name), name);
}

const expectedNames = new Set([...customNames, ...Object.keys(config)]);
const existingNames = await listDirectories(skillsRoot);
for (const name of existingNames) {
  if (!expectedNames.has(name)) {
    await rm(path.join(skillsRoot, name), { recursive: true, force: true });
    console.log(`已移除不再管理的 Skill：skills/${name}`);
  }
}

await mkdir(skillsRoot, { recursive: true });
for (const name of customNames) {
  await rm(path.join(skillsRoot, name), { recursive: true, force: true });
  await cp(path.join(customRoot, name), path.join(skillsRoot, name), {
    recursive: true,
    force: true,
  });
  console.log(`已同步 custom/${name} -> skills/${name}`);
}

for (const name of names) {
  const entry = config[name];
  if (!entry) throw new Error(`没有找到 Skill 配置：${name}`);
  const sourceRoot = path.resolve(repoRoot, entry.submodule);
  const source = path.resolve(sourceRoot, entry.skillPath);
  const destination = path.resolve(skillsRoot, name);
  assertInside(repoRoot, sourceRoot, "来源");
  assertInside(sourceRoot, source, "Skill 来源");
  assertInside(skillsRoot, destination, "发布目标");

  git(["submodule", "update", "--init", ...(update ? ["--remote"] : []), "--", entry.submodule]);
  await validateSkill(source, name);
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  console.log(`已同步 ${name} -> skills/${name}`);
}
