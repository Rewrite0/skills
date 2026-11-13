# 我的 Skills 仓库

个人 Agent Skills 集合，发布内容位于 `skills/`。

## 安装

```bash
# 查看可安装的 Skill
pnpx skills add Rewrite0/skills --list
# 安装指定 Skill
pnpx skills add Rewrite0/skills --skill tdd
# 交互式安装
pnpx skills add Rewrite0/skills
# 更新已安装的全局 Skill
pnpx skills update -g
```

## 维护

需要 Node.js >= 22.18.0 和 pnpm。

```bash
pnpm install
```

| 路径 | 用途 |
| --- | --- |
| `skills/` | 提交到仓库的 Skill 发布目录 |
| `sources/` | 外部仓库的本地缓存，不提交 |
| `meta.json` | 来源仓库及 Skill 选择配置 |
| `scripts/cli.ts` | 来源管理、同步与校验 |

### 来源配置

在 `meta.json` 中配置来源。`skills` 的键是 Skill 名称，值是来源仓库中的相对目录：

```json
{
  "sources": {
    "mattpocock-skills": {
      "url": "https://github.com/mattpocock/skills.git",
      "skills": {
        "tdd": "skills/engineering/tdd"
      }
    }
  },
  "manual": []
}
```

- 省略 `skills` 或设置为 `{}`：启用该来源的全部 Skill，包括以后新增的 Skill。
- 如需停用来源，直接从 `sources` 中移除该来源。
- 可选填 `branch`：指定更新分支，默认使用远端默认分支。

已登记的来源需要调整 Skill 时，编辑对应来源的 `skills` 映射，然后运行 `pnpm run sync`。省略 `skills` 或设置为空对象都会启用全部 Skill；如需停用来源，直接移除该来源。

### 新增来源

```bash
# 选取部分 Skill
pnpm run sources:add https://github.com/example/skills --skills skill-a,skill-b
# 启用全部 Skill
pnpm run sources:add https://github.com/example/skills
# 指定分支
pnpm run sources:add https://github.com/example/skills --branch main --skills skill-a
```

命令会克隆来源、写入配置并同步，来源名称默认为 `<用户名>-<仓库名>`。

### 同步和更新

```bash
# 初始化来源缓存
pnpm run sources:init
# 从当前缓存同步
pnpm run sync
# 获取上游更新并同步
pnpm run update
# 只更新并同步指定 Skill
pnpm run update tdd
```

`sync` 也支持指定 Skill；`sources:init` 和 `sources:update` 支持指定来源名称。`sources:update` 只更新缓存。

外部 Skill 应在上游修改后重新同步；缓存有本地修改时更新会停止。手写 Skill 直接维护在 `skills/<name>/`，并将名称登记到 `manual` 数组中。

### 校验

```bash
# 类型、发布文件和安装清单
pnpm run check
# 脚本 lint
pnpm run lint
```

校验无需来源缓存；全部启用来源的发现、重名检查和目录清理由同步完成。更多命令见 `node scripts/cli.ts --help`。

## 自动化

GitHub Actions 在 push 和 Pull Request 时校验，每周更新外部 Skill 并创建更新 PR，也支持手动触发。
