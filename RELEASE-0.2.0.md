# Planners Form 0.2.0

Skill 安装/更新改为跟随上游最新版本；检查更新不再被 GitHub API 限流打断；插件可以在设置页更新自身；出问题时可以复制一段修复指令交给用户的 Agent。

## 跟随上游最新版本

catalog 不再固定每个 Skill 的提交。安装或更新时，插件实时解析仓库 `main` 的当前提交，再按 SHA 下载并校验：

1. git 的 ref 广告（`info/refs?service=git-upload-pack`，无 API 配额）
2. commits Atom feed（无 API 配额）
3. GitHub REST API（仅兜底）

先解析 SHA 再按 SHA 下载，检查与下载之间分支移动不会装到不同字节。`repair` 恢复已记录的那一版，不顺手升级；`install` 不会升级已受管理的公共依赖；`update-all` 单项失败只跳过该项。

## 检查更新

只检查已安装的 Skill 和插件自身，逐项报告错误。任何一项失败都不再阻断其他项的更新，也不会再出现 15 个包一起“检查失败（403）”。

## 插件自更新

设置页显示当前版本、commit 与最新 Release。宿主提供官方 `pluginManager` 服务时，“更新插件”调用宿主的 `installBundle('github:thePlannerIvan/planners-form#<sha>')`，由宿主负责 pnpm、profile 锁、manifest 备份与 HMR 重组合；没有该服务或当前是本地开发安装时，降级为“复制更新指令”。桌面版更新后需要重启 DSH 才完全生效。

## 复制修复指令给 Agent

设置页新增“复制修复指令给 Agent”：服务端采集插件版本、profile、安装方式、错误、最近日志、网络与 Skill 状态，生成含分类处置和验收标准的 Prompt，并对 token、cookie、密钥形态的文本做脱敏。插件进程拿不到 DSH_PROFILE 环境变量时，会从自身安装路径推导 profile，避免 Prompt 里出现“profile 未知 / 安装方式未知”。用户把它发给自己的 Agent 即可自检自修；如果仍无法修复，或发现插件本身有可优化的点，指令末尾会要求把诊断书发送到 Lawyif@163.com。

## 验证

- `npm test`：60 项，59 通过、1 跳过（需要 `DSH_TEST_RUNTIME` 的真实 DSH registry 集成），0 失败
- `npm run check`：全部 `lib/*.js` 通过语法检查
- 真实网络实测：`resolveCommit` 与 `resolveRelease` 可取到上游提交/版本，且不消耗 API 配额
- 未实测：在运行中的桌面宿主上完成一次真实自更新、CLI 降级路径的沙箱批准流程、修复 Prompt 的端到端执行

## 从 0.1.x 升级

旧版的检查更新走未认证的 GitHub API，可能整页 403，也没有自更新入口。升级到 0.2.0 需要手工重装一次：在 DSH 插件页添加同一个 GitHub 地址，或用应用自带 CLI 执行 `dsh plugin --profile <profile> add github:thePlannerIvan/planners-form#<commit>`。装好 0.2.0 之后，后续更新就可以走设置页的自更新或“复制更新指令”。

## 内置 Review Dock 升到 0.2.5

随包内置的审阅宿主从 0.2.4 升到 0.2.5（允许审阅页使用 same-origin，供 HyperFrames 等内嵌播放器使用），并修正 `package-lock.json` 里遗留的 0.2.3 版本标记。`node_modules/dsh-review-dock` 已按 Git 安装要求物化为普通文件。

安装地址：https://github.com/thePlannerIvan/planners-form
