<p align="center">
  <img src="assets/icon.svg" width="80" alt="Planners Form" />
</p>

<h1 align="center">Planners Form</h1>

<p align="center"><strong>在 DSH 里讨论方案、写作、做 PPT、剪视频。</strong></p>

Planners Form 是一个为 DSH 准备的办公插件，也是 Planners 系列工具的统一入口。把一个想法聊清楚，把一堆资料写成方案，再把内容做成 PPT 或视频——你可以根据手上的工作，装上需要的能力，在对话里一步步完成。

复制仓库链接，在 DSH 中点一下安装。之后需要什么功能，就在设置里选择，不必逐个寻找和配置配套 Skill。

## 从想法到交付，你可以用它做什么？

### 一起把方案想明白

拿着 Brief、研究资料，或者一个还没想清楚的问题开始。和 AI 讨论业务卡点、比较不同方向，逐步形成有判断、有依据的方案主线。

### 把资料写成可以用的内容

把主线展开成完整的逐页稿，梳理每一页要讲什么、用什么证据、配什么素材。也可以先分析访谈、评论或表格数据，再把发现带回方案。

### 把内容做成 PPT

从逐页稿或已有材料出发，制作页面，在审阅中提出修改，最后输出可编辑的 PPT。内容调整和页面返修可以在同一段工作里继续推进。

### 从视频创意走到成片

讨论选题和创意，把主张写成能直接念的口播稿；有了录音、素材或页面后，继续完成剪辑、字幕、画面制作和成片审阅。

这些能力可以接着用，也可以单独用。只需要写方案，就装方案相关的功能；今天要剪一条视频，就从视频制作开始。

## 装进 DSH

在 DSH 中打开 **插件 → 添加插件**，粘贴下面的地址，点击 **安装**：

```text
https://github.com/thePlannerIvan/planners-form
```

安装并启用后，打开 **设置 → Planners Form**，勾选需要的功能，点击 **安装所选 Skill**。相关的辅助 Skill 会一起准备好。

> 安装框里填写上面的仓库地址即可。GitHub 的 Release 展示页不是安装地址。

## 回到对话，开始工作

装好后，直接告诉 DSH 你想做什么，并带上对应的 Skill 名称。例如：

> 用 planners-proposal-system 和我讨论这份 Brief，先把方案方向和主线定下来。

> 用 planners-bypage 把刚才确认的主线展开成完整的逐页内容。

> 用 planners-ppt-hell 把这份逐页稿做成 PPT，我会在审阅页里提修改。

> 用 video-craft 剪这段口播，去掉重复和停顿，加上字幕，先给我审阅。

需要你看稿、看页面或确认成片时，对应 Skill 会打开审阅页。你继续在对话中提出意见、调整内容，直到完成交付。

## 按工作选择能力

| 你想完成的工作 | 对应 Skill |
| --- | --- |
| 讨论策略、组织方案主线 | `planners-proposal-system` |
| 写完整的逐页内容 | `planners-bypage` |
| 校对文章、检查错别字与表达 | `editor` |
| 制作和修改可编辑 PPT | `planners-ppt-hell` |
| 分析访谈、评论与开放文本 | `planners-quali-box` |
| 分析表格与结构化数据 | `planners-quanti-box` |
| 构思视频、写口播与画面内容 | `video-idea-system` |
| 剪辑视频、制作字幕与成片 | `video-craft` |

方案研讨、叙事和幻灯片文案所用的辅助能力，会随相关功能一起安装。日常在 **设置 → Planners Form** 中直接安装或更新即可：安装与更新会取上游最新版本，不再需要等插件发版才能拿到 Skill 的修复。

## 更新与排障

**Skill 更新**：设置页每次安装或更新都取上游 `main` 的最新提交；检查更新只检查已安装项，单项失败不会影响其他项，也不会再被 GitHub API 限流打成整页红色。

**插件自身更新**：插件版本行会显示当前版本、commit 与最新 Release。装了 DSH 提供插件管理服务的版本时可以点“更新插件”一键更新；没有该服务或当前是本地开发安装时，点“复制更新指令”，把生成的内容发给你的 Agent 执行官方 `plugin_manager` 工具或应用自带 CLI，更新完成后重启 DSH。

> 从 0.1.x 升到 0.2.0 需要手工重装一次插件（插件页添加 GitHub 地址，或用应用自带 CLI）。旧版的检查更新仍可能被 GitHub 限流打成 403，新机制要在 0.2.0 里才生效；升级之后的自更新就不再有这个门槛。

**遇到问题**：先点 **复制修复指令给 Agent**，把内容直接发给你正在用的 Agent。里面已经包含插件版本、DSH profile、安装方式、错误、最近日志、脱敏诊断快照和分场景修复步骤，Agent 可以据此自检自修，不需要联系作者，也不需要你手工翻目录。修复指令包含本机路径但不含令牌。如果 Agent 按指令仍无法修复，或在排查中发现可优化的点，指令末尾会要求把诊断书发送到 Lawyif@163.com。

## 使用前的小提示

目前支持 **DSH 0.2.x**（声明 `^0.2.0-rc.2`；0.2.1-rc.1 已实测）。安装和下载配套功能需要联网。首次使用视频制作时，还需按 [Video Craft 安装说明](https://github.com/thePlannerIvan/video-craft/blob/main/install.md) 配置渲染工具。

插件的新版本可在 [Releases](https://github.com/thePlannerIvan/planners-form/releases) 获取。反馈问题前，附上“复制修复指令给 Agent”生成的内容会更容易定位。

## 开源与作者

由 **阿祖不看 TVC / thePlannerIvan** 创建与维护。

Planners Form 的源码以 **AGPL-3.0-only** 开放，欢迎阅读、反馈和参与改进。

[个人网站](https://demyth.info) · [许可证](LICENSE) · [作者与第三方声明](NOTICE) · [开发文档](DEVELOPMENT.md) · [兼容性记录](COMPATIBILITY.md) · [安全反馈](SECURITY.md)

联系：Lawyif@163.com
