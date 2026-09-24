#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const configPath = path.join(repoRoot, "skills.config.json");
const usage =
  "用法：pnpm run sources:add <repository-url> [--branch <branch>] [--skills <skill1,skill2,...>]";

function fail(message) {
  console.error(`${message}\n${usage}`);
  process.exit(1);
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function syncSkills() {
  const syncScript = path.join(repoRoot, "scripts", "sync-skills.mjs");
  const result = spawnSync(process.execPath, [syncScript], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sourceNameFromUrl(repositoryUrl) {
  const normalized = repositoryUrl
    .replace(/^git@[^:]+:/, "https://github.com/")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const parts = normalized.split(/[/:]/).filter(Boolean);
  if (parts.length < 2) return undefined;
  const repository = parts.at(-1);
  const owner = parts.at(-2);
  if (!owner || !repository) return undefined;
  return `${owner}-${repository}`;
}

async function findSkillFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(fullPath, relativePath)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(relativePath);
    }
  }
  return files;
}

async function readSkillName(filePath) {
  const content = await readFile(filePath, "utf8");
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
  return frontmatter?.[1].match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
}

const args = process.argv.slice(2);
const repositoryUrl = args.shift();
if (!repositoryUrl || repositoryUrl.startsWith("-")) fail("缺少外部仓库地址。");

let branch;
let requestedSkills;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--branch") {
    branch = args[++index];
    if (!branch || branch.startsWith("-")) fail("--branch 后需要提供分支名。");
  } else if (argument === "--skills") {
    requestedSkills = args[++index]
      ?.split(",")
      .map((skill) => skill.trim())
      .filter(Boolean);
    if (!requestedSkills?.length) fail("--skills 后需要提供 Skill 名称。");
  } else {
    fail(`不支持的参数：${argument}`);
  }
}

const sourceName = sourceNameFromUrl(repositoryUrl);
if (!sourceName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sourceName)) {
  fail(`无法从仓库地址推断来源目录名：${repositoryUrl}`);
}

const destination = path.join(repoRoot, "sources", sourceName);
if (existsSync(destination)) fail(`来源目录已存在：sources/${sourceName}`);

// --force 允许复用之前失败或取消操作留下的本地 submodule 缓存（.git/modules）。
// 如果 sources/<name> 实际目录已存在，前面的 existsSync 检查仍会阻止覆盖。
const gitArgs = ["submodule", "add", "--force"];
if (branch) gitArgs.push("-b", branch);
gitArgs.push(repositoryUrl, `sources/${sourceName}`);
runGit(gitArgs);

const skillFiles = await findSkillFiles(destination);
const discovered = [];
for (const relativeFile of skillFiles) {
  const skillName = await readSkillName(path.join(destination, relativeFile));
  if (skillName) {
    discovered.push({
      skillName,
      skillPath: path.dirname(relativeFile) || ".",
    });
  }
}

if (!discovered.length) fail(`来源仓库中没有找到带 name 的 SKILL.md：sources/${sourceName}`);
const uniqueDiscovered = new Map(
  discovered.map((skill) => [skill.skillName, skill]),
);
if (uniqueDiscovered.size !== discovered.length) {
  fail("来源仓库中存在重名 Skill，无法自动生成唯一配置。");
}
const discoveredNames = new Set(uniqueDiscovered.keys());
const selectedNames = requestedSkills ?? discovered.map(({ skillName }) => skillName);
const missing = selectedNames.filter((skillName) => !discoveredNames.has(skillName));
if (missing.length) fail(`没有找到指定 Skill：${missing.join(", ")}`);

const config = JSON.parse(await readFile(configPath, "utf8"));
for (const skillName of selectedNames) {
  if (config[skillName]) fail(`skills.config.json 中已存在 Skill：${skillName}`);
  const skill = uniqueDiscovered.get(skillName);
  config[skillName] = {
    submodule: `sources/${sourceName}`,
    skillPath: skill.skillPath,
  };
}
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`已添加 sources/${sourceName}。`);
console.log(`已登记 ${selectedNames.length} 个 Skill 到 skills.config.json：${selectedNames.join(", ")}`);
console.log("开始同步到 skills/ 发布目录...");
syncSkills();
