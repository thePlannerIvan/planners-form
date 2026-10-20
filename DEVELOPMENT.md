# 开发与安装参考

面向使用者的介绍和安装步骤见 [README](README.md)。

## 安装位置与更新

以 `$DSH_HOME` 为准，默认 `~/.dsh`：

```text
planners-form/
  skills/          管理的 Skill 与依赖
  python/          PPT 的独立 Python 环境
  state.json       安装版本
  install.lock     安装互斥
  journal.json     未完成事务恢复记录（完成后移除）
skills/
  <skill-name>     指向受管理 Skill 的链接，供 DSH 发现
```

设置页读取 DSH `skills.snapshot()` 的有效清单，按 Skill 名称与实际资源目录识别已有安装，支持宿主注册的自定义目录。插件通过 DSH 原生 `FileSystemSkillProvider` 注册本地来源（`$DSH_HOME/skills` 与 `$DSH_AGENTS_HOME/skills`，后者默认 `~/.agents/skills`），使新安装即使在默认文件来源被关闭时也能被本地 Agent 发现；安装成功会立即失效化清单缓存。项目或特定 Agent 私有作用域的 Skill 不作为全局安装显示。

有效的外部 Skill 不覆盖、不接管；没有有效 Skill 的同名目录会提示冲突。公共外部模块会建立只读使用的链接，供受管理 Skill 找到兄弟依赖。

初次安装与更新都直接取上游 `main` 的最新提交：`lib/upstream.js` 先走 git 的 ref 广告（`info/refs?service=git-upload-pack`），失败再走 commits Atom，最后才用 GitHub REST API 兜底。**不占用 API 配额**，因此共享代理出口也不会再出现“检查更新全部 403”。解析到 SHA 之后仍按 SHA 下载并校验，所以检查与下载之间分支移动不会拿到不同字节。`catalog.json` 只保存元数据（ID、标题、依赖、仓库、运行时），不再固定 revision。**这表示上游更新，不表示整套兼容认证**。建议在任务空闲时更新，已有 Agent 上下文不会被重写。

`repair` 恢复“已记录的那一版”，不主动升级；`install` 不会顺手升级已受管理的共享依赖；`update-all` 单项失败只跳过该项，不再整体回滚。

插件自身的更新同样先查上游 `main` 与最新 Release（`releases.atom`）。宿主提供 `pluginManager` 服务时，设置页的“更新插件”调用宿主的 `installBundle('github:thePlannerIvan/planners-form#<sha>')`，由宿主负责 pnpm、profile 锁、manifest 备份与 HMR 重组合；没有该服务（或本地开发安装）时，降级为“复制更新指令”，交给用户的 Agent 按官方 `plugin_manager` 工具或应用自带 CLI 执行。桌面版更新后必须重启 DSH 才会完全生效。

设置页的“复制修复指令给 Agent”会生成一份含现场、错误、脱敏快照、分类处置与验收标准的 Prompt；诊断只读取本机状态，不含 token、cookie 或密钥，但会包含路径与最近日志，由用户决定是否发送。

更新不访问项目目录。安装失败会恢复先前 Skill 文件与状态；Python 环境安装是独立准备步骤，失败可重试，不回滚 pip 缓存。

## 开发与验证

```sh
git clone https://github.com/thePlannerIvan/planners-form.git
cd planners-form
npm test
npm run check
npm pack
```

`test/` 使用隔离目录和合成仓库包，覆盖真实 tar 解包、下载失败、依赖安装、更新、外部目录保护、事务恢复和请求来源校验。

## 当前验证边界

正式兼容目标为 **DSH 0.2.x**：`peerDependencies` 与 `engines.dsh` 都声明 `^0.2.0-rc.2`，0.2.1 起 DSH 的兼容性判定优先看 `engines.dsh`。发行包已在 **0.2.1-rc.1** 上用桌面应用内置运行时与 Node 24.21.0，在全新隔离 Web profile 中通过官方命令安装并实测：组合树不再跳过、设置栏目与客户端 bundle 正常注入、鉴权接口与 Review 路由行为符合预期（见 COMPATIBILITY.md）。0.2.0-rc.2 的旧记录保留在下方。此前也做过 0.1.7-rc.1 开发验证，但发行包不再声明 0.1 线。

已完成公开仓库的匿名访问和真实 Skill 下载、依赖安装及 DSH 链接检查。PPT 的 Python / Chromium 配置、视频渲染工具配置，以及桌面版和 Windows 完整安装仍需分别实测。


开发说明：仓库有意保留 `node_modules` 中经过锁定的生产依赖及许可证，以支持 DSH 从 GitHub 直接安装。更新依赖后先运行 `node scripts/prepare-bundled-deps.mjs`（Git 安装不会保留链接形式的内置依赖），然后将其变化与 `package-lock.json` 一起提交，并运行源码归档导入测试。测试读取 Git 暂存区的待发布文件；修改后先 `git add` 再运行测试。
