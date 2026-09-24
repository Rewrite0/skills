#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("skills");
const customRoot = path.resolve("custom");
const config = JSON.parse(await readFile("skills.config.json", "utf8"));
const entries = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();

if (entries.length === 0) {
  console.error("skills/ 中没有找到 Skill。");
  process.exit(1);
}

const customEntries = await readdir(customRoot, { withFileTypes: true }).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const customNames = customEntries
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name);
const expectedNames = new Set([...customNames, ...Object.keys(config)]);
const errors = [];
for (const name of expectedNames) {
  if (!entries.includes(name)) errors.push(`${name}: 未同步到 skills/`);
}
for (const name of entries) {
  if (!expectedNames.has(name)) errors.push(`${name}: skills/ 中存在未管理的 Skill`);
}
if (customNames.some((name) => config[name])) {
  errors.push("custom/ 与 skills.config.json 存在重名 Skill");
}
for (const name of entries) {
  const file = path.join(root, name, "SKILL.md");
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("不是文件");
    const content = await readFile(file, "utf8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const declaredName = match?.[1].match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
    if (!declaredName) errors.push(`${name}: SKILL.md 缺少 frontmatter name`);
    else if (declaredName !== name) errors.push(`${name}: frontmatter name 为 ${declaredName}`);
  } catch (error) {
    errors.push(`${name}: 缺少有效的 SKILL.md（${error.message}）`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`检查通过：${entries.length} 个 Skills`);
