# 我的 Skills 仓库

个人 Agent Skills 聚合仓库

## 使用

查看仓库中可安装的 Skills：

```bash
pnpx skills add . --list
```

安装指定 Skill：

```bash
pnpx skills add . --skill tdd --global
pnpx skills ls -g
```

安装全部 Skills：

```bash
pnpx skills add . --skill '*' --global
```

## 目录结构

```text
.
├── custom/              # 本仓库自己维护的 Skills
│   └── <skill-name>/
│       └── SKILL.md
├── skills/              # 由 custom/ 和 sources/ 合并生成的发布目录
│   └── <skill-name>/
│       └── SKILL.md
├── sources/             # 外部 Skill 项目（Git submodules）
├── scripts/              # 同步和校验脚本
├── skills.config.json    # 来源项目与 Skill 路径映射
├── .gitmodules
└── README.md
```

`sources/` 只保存外部项目的 submodule，`custom/` 保存本仓库自己维护的 Skills；真正供安装器发现和安装的内容位于 `skills/`。
`skills/` 是同步生成目录，不应直接修改。安装器不会递归拉取 submodule，因此外部 Skill 必须同步到发布目录。

## 管理来源和同步

初始化外部来源：

```bash
pnpm run sources:init
```

同步当前锁定的 submodule 版本，并根据 `custom/` 与 `skills.config.json` 清理发布目录：

```bash
pnpm run sync
# 只同步一个 Skill
pnpm run sync -- tdd
```

更新来源仓库并同步：

```bash
pnpm run update
```

新增外部来源时，使用脚本添加 submodule。脚本会按照 `<用户名>-<仓库名>` 自动推断来源目录名：

```bash
pnpm run sources:add https://github.com/example/skills
```

上面的仓库会添加到:

```text
sources/example-skills
```

脚本会自动扫描仓库中的全部 `SKILL.md`，并将所有 Skill 登记到
`skills.config.json`。如果只需要其中一部分，可以使用 `--skills`：

```bash
pnpm run sources:add https://github.com/example/skills \
  --skills skill-a,skill-b
```

也可以指定来源分支：

```bash
pnpm run sources:add https://github.com/example/skills --branch main
```

脚本会执行 `git submodule add`、发现 Skill、更新 `skills.config.json`，并自动同步到
`skills/` 发布目录。

外部来源的修改应在来源仓库中完成，不要直接修改 `skills/<skill-name>/` 的同步副本。

对于没有外部来源、由本仓库维护的 Skill，直接将完整目录放入
`custom/<skill-name>/`，并确保其中存在 `SKILL.md`。运行 `pnpm run sync` 后会发布到
`skills/<skill-name>/`。如果从配置或 `custom/` 中删除 Skill，下一次同步也会从 `skills/` 中移除对应目录。

## 常用 scripts

```bash
# 检查 Skill 文件和 CLI 清单
pnpm run check

# 单独检查 Skill 目录与 frontmatter
pnpm run skills:check

# 查看仓库中的可安装 Skills
pnpm run skills:list

# 使用 skills CLI 添加 Skill
pnpm run skills:add -- --skill tdd --global

# 初始化、同步或更新外部 submodules
pnpm run sources:init
pnpm run sync
pnpm run update

# 校验维护脚本
pnpm run lint
```

## GitHub Actions

`.github/workflows/check.yml` 会在 push、Pull Request 和手动触发时校验 Skill 文件及 CLI 清单。

`.github/workflows/update-skills.yml` 每周一自动更新外部 submodule，同步发布目录并创建更新 Pull Request；也可以在 GitHub Actions 页面手动运行。

当前已导入本机已有 Skills；其中可识别来源的 Skill 已通过 `sources/` 下的 Git
submodule 管理，后续应在本仓库维护和提交来源指针及同步后的 `skills/` 内容。
