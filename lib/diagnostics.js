// Diagnostic snapshot + the copyable prompts the settings page hands to the
// user's agent: one to repair a broken install, one to update Planners Form
// itself. The repair prompt ends with an email fallback for cases the agent
// cannot fix, or for optimization notes worth sending upstream. Rendering
// lives here so it is a pure function of a snapshot and can be tested without
// a running DSH host.

const SCHEMA = 1;
const MAX_SNAPSHOT_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_LOG_LINES = 40;
const SUPPORT_EMAIL = 'Lawyif@163.com';

function clip(value, max = MAX_MESSAGE_CHARS) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function lines(value, max = MAX_LOG_LINES) {
  const text = typeof value === 'string' ? value : '';
  const all = text.split('\n').filter(line => line.trim() !== '');
  return all.slice(-max).join('\n');
}

/** Remove anything credential-shaped from text that may have reached an error message. */
export function scrub(text) {
  return String(text ?? '')
    .replace(/(token|cookie|authorization|password|secret|api[_-]?key)\s*[:=]\s*\S+/giu, '$1: [已隐去]')
    .replace(/([?&](?:token|key|access_token)=)[^&\s]+/giu, '$1[已隐去]');
}

function json(value) {
  const body = JSON.stringify(value, null, 2);
  return body.length <= MAX_SNAPSHOT_CHARS ? body : `${body.slice(0, MAX_SNAPSHOT_CHARS)}\n…（快照已截断）`;
}

function pathLine(snapshot, key) {
  return snapshot.paths?.[key] ?? '未知';
}

function factLines(snapshot) {
  const plugin = snapshot.plugin ?? {};
  const runtime = snapshot.runtime ?? {};
  const modeLabel = {github: 'GitHub 安装', link: '本地开发目录', file: '本地文件包', other: '其他来源', unknown: '未识别'}[plugin.mode] ?? plugin.mode;
  return [
    `- 插件：planners-form ${plugin.version ?? '未知'}${plugin.commit === null || plugin.commit === undefined ? '' : `（commit ${String(plugin.commit).slice(0, 12)}）`}${plugin.ahead === true ? '（本地预览版，新于最新发布）' : ''}`,
    `- 安装方式：${modeLabel}${plugin.spec === null || plugin.spec === undefined ? '' : `（${plugin.spec}）`}`,
    `- DSH profile：${plugin.profile ?? '未知'}${plugin.profileDir === null || plugin.profileDir === undefined ? '' : `（${plugin.profileDir}）`}`,
    `- 插件根目录：${pathLine(snapshot, 'root')}`,
    `- Skill 根目录：${pathLine(snapshot, 'skills')}`,
    `- 运行时：Node ${runtime.node ?? '未知'}；${runtime.platform ?? ''} ${runtime.arch ?? ''}`.trim(),
    `- 快照时间：${snapshot.generatedAt ?? '未知'}`,
  ];
}

function errorLine(snapshot) {
  return snapshot.errors?.length ? snapshot.errors.join('\n') : '（无显式错误；请按下面的诊断顺序逐项核验）';
}

function skillLines(snapshot) {
  const rows = snapshot.skills?.rows ?? [];
  if (rows.length === 0) return '（当前没有由 Planners Form 管理的 Skill）';
  return rows
    .map(row => `- ${row.id}：${row.ownership ?? '未知'}${row.installedRevision ? ` @ ${String(row.installedRevision).slice(0, 10)}` : ''}${row.update ? ` → 可更新 ${String(row.update).slice(0, 10)}` : ''}${row.checkError ? `（检查失败：${clip(row.checkError, 300)}）` : ''}`)
    .join('\n');
}

/** Build the repair prompt a user pastes into their agent. */
export function renderFixPrompt(snapshot) {
  const facts = factLines(snapshot).join('\n');
  const snapshotText = json(snapshot);
  const log = clip(lines(snapshot.job?.logTail), MAX_MESSAGE_CHARS);
  return `# 任务：修复本机 Planners Form 的故障

你是一名熟悉 DSH（DeepSeek Harness）插件与 Skill 安装的工程师。请先在本机定位并修复下面这台机器上的故障，最后按验收标准复核；如果确实无法修复，按第 9 节把诊断书发给作者。

## 1. 现场
${facts}

## 2. 用户看到的现象与错误
错误：
\`\`\`
${errorLine(snapshot)}
\`\`\`

最近操作日志：
\`\`\`
${log || '（无）'}
\`\`\`

## 3. 只读快照（已脱敏，不含任何令牌）
\`\`\`json
${snapshotText}
\`\`\`

## 4. 约束（必须遵守）
1. 先只读诊断，再动手；任何删除或覆盖前，先备份到 \`${pathLine(snapshot, 'root')}/backup-<时间>/\`。
2. 不覆盖、不接管 ownership=external 的 Skill；不删除用户自己的内容。
3. 不修改与 Planners Form 无关的 profile 插件。
4. 不把 token、cookie、Authorization、代理密码或 .env 内容写进输出。
5. 不关闭 TLS 校验，不使用来历不明的镜像。
6. 破坏性命令先说明影响，等用户确认后再执行。
7. 如果当前 DSH 沙箱不允许写 profile 目录，如实说明需要用户批准或使用 danger-full-access。

## 5. 诊断顺序
1. 用一句话复述故障分类与最可能的原因，列出你依据的快照字段。
2. 只读核验（按需，不要全跑）：
   - \`node --version\`、\`git --version\`、\`python3 --version\`、\`uv --version\`
   - 对相关仓库执行 \`git ls-remote https://github.com/<repo>.git refs/heads/main\`
   - \`curl -sSI https://codeload.github.com/<repo>/tar.gz/<sha>\`
   - \`ls -la "${pathLine(snapshot, 'skills')}" "${pathLine(snapshot, 'mounts')}"\`，并用 \`readlink\` 检查挂载
   - 读取 \`${pathLine(snapshot, 'stateFile')}\`、\`${pathLine(snapshot, 'root')}/journal.json\`、\`${pathLine(snapshot, 'root')}/install.lock\`
3. 按第 6 节分类处理。
4. 修复后按第 7 节验收。

## 6. 分类处置
### A. 检查更新失败 / 403 限流
- 旧版本会把更新检查发往 api.github.com（未认证，60 次/小时）。确认当前版本是否仍这样做；若是，升级到 0.2.0 或改用 \`git ls-remote\` / commits Atom 校验。
- 不要连续点击；单项失败不应阻断其他更新。不要要求用户提供 GitHub token。

### B. 下载或解包失败
- 404：核对仓库、分支、commit SHA 是否存在且公开。
- 超时/代理：核对 \`http_proxy\`/\`https_proxy\`/\`no_proxy\`，确认 codeload.github.com 可达。
- tar 校验失败：列出违规 entry（symlink、\`..\`、绝对路径、.env、node_modules、超大文件）；清理 \`${pathLine(snapshot, 'root')}/staging\` 后重试。

### C. Skill 标识不匹配
- 检查仓库根目录 \`SKILL.md\` 的 frontmatter \`name\` 是否等于目标 Skill 名；确认没有把子目录当成仓库根。

### D. Python 环境准备失败
- 需要 Python 3.10+ 或 uv。查看 venv/ensurepip/pip/playwright 的 stderr；修好权限、代理或磁盘后重试。不要删除已安装 Skill。

### E. 外部目录或路径冲突
- 对比 mount 与 target 的 lstat/readlink；external 安装永不覆盖。备份后移动或重命名冲突目录，删除悬空 alias。

### F. 审阅页打不开
- 确认 planners-review-core 已安装且目录里有审阅页资产；检查 \`DSH_REVIEW_CORE_DIR\` 与 \`PLANNERS_REVIEW_PYTHON\` 是否指向旧副本；确认 dsh-review-dock 版本 ≥ 0.2.4。

### G. 版本不兼容 / 设置页不出现
- 对比 DSH 版本与插件 \`engines.dsh\` / peer 范围；确认 bundle 是否被兼容性门禁跳过；查 \`.plugin-manager/logs\`。安装匹配版本，不要只改 engines 绕过检查。

### H. 锁、中断事务、权限
- 检查 \`install.lock\` 的 pid 是否存活、\`journal.json\` 是否存在、staging 是否残留。
- 备份后删除陈旧锁或未完成事务，再重跑“检查 / 修复”。不要删除用户数据。

### I. Skill 清单不完整
- 重试并检查 DSH 技能清单是否完整；确认 profile 的 \`cordis.patch.yml\` 与 provider 配置；必要时重启 DSH。

## 7. 验收标准
- 设置页能正常打开，\`GET /api/planners-form\` 返回 200 且包含版本与 Skill 列表。
- 检查更新不再因单项失败而整体失败；每个 Skill 有明确状态。
- 至少成功完成一次 install 或 repair；\`state.json\` 与磁盘目录一致。
- 审阅页可打开（若原先故障涉及审阅）。
- 重启 DSH 后设置页仍然正常。

## 8. 输出格式
- 根因（一句话）+ 证据（具体字段或命令输出）。
- 实际改动（文件、命令、备份位置）。
- 验收结果（逐条）。
- 未解决项与建议（如有）。

若确认是插件自身的代码缺陷，给出最小补丁、复现步骤，并说明更新会覆盖临时补丁。

## 9. 修不好或发现可优化点时
如果按上述步骤仍无法修复，或者你在排查中发现 Planners Form 本身有值得优化的地方，请把这份诊断书发送到 ${SUPPORT_EMAIL}（主题可写「Planners Form 问题诊断书」）。发送前请让用户确认内容中没有不希望公开的信息。
`;
}

/** Build the self-update prompt for the user's agent (planners-form itself). */
export function renderUpdatePrompt(snapshot) {
  const plugin = snapshot.plugin ?? {};
  const commit = plugin.latestCommit ?? null;
  const version = plugin.latestVersion ?? null;
  const target = commit === null ? 'github:thePlannerIvan/planners-form' : `github:thePlannerIvan/planners-form#${commit}`;
  const gitTarget = commit === null ? 'git+https://github.com/thePlannerIvan/planners-form.git' : `git+https://github.com/thePlannerIvan/planners-form.git#${commit}`;
  return `# 任务：把本机的 Planners Form 插件更新到最新版

你是一名熟悉 DSH（DeepSeek Harness）插件管理的工程师。请在不联系插件作者的前提下，更新下面这台机器上的 Planners Form，并完成验证。

## 1. 现场
${factLines(snapshot).join('\n')}
- 已安装版本：${plugin.version ?? '未知'}${plugin.commit ? `（commit ${String(plugin.commit).slice(0, 12)}）` : ''}
- 最新版本：${version ?? '未知'}${commit ? `（commit ${String(commit).slice(0, 12)}）` : ''}
- profile 安装 spec：${plugin.spec ?? '未知'}
- 目标 spec：\`${target}\`

## 2. 做法（按优先级，失败再降级）
1. **官方宿主工具**：如果你的工具列表里有 \`plugin_manager\`，调用
   \`plugin_manager install_bundle\`，参数 target 用 \`${gitTarget}\`，必要时带 registry。按返回的 \`application\` 判断：
   - \`applied\`：已热更新，提示用户刷新页面即可。
   - \`restart-required\`：提示用户完全退出并重新打开 DSH。
   - \`failed\`：把错误与诊断原样转述，不要静默重试。
2. **应用自带的 dsh CLI**（没有 plugin_manager 工具时）：
   - macOS：\`\`\`sh
     CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
     "$CLI" --version   # 应先与当前 DSH 版本一致
     "$CLI" plugin --profile ${plugin.profile ?? '<profile>'} add ${target}
     \`\`\`
   - 其他平台：在 DSH 安装目录的 \`runtime/cli/bin/\` 下找 \`dsh\`（Windows 为 \`dsh.cmd\`），不要用 PATH 上版本不一致的旧 \`dsh\`。
   - 这条命令需要写 profile 目录；如果被沙箱拒绝，请向用户申请批准或使用 danger-full-access。
3. 更新前先备份 profile 的 \`package.json\` 与 \`pnpm-lock.yaml\` 到 \`${pathLine(snapshot, 'root')}/backup-<时间>/\`；失败时恢复这两个文件，并说明 node_modules 可能已被部分改写。

## 3. 验证
- 读取 \`${plugin.profileDir ?? '<profileDir>'}/node_modules/planners-form/package.json\`，确认版本号已是 ${version ?? '最新版本'}（或 commit 已是 ${commit ? commit.slice(0, 12) : '最新'}）。
- 重新打开 设置 → Planners Form，确认页面正常、版本行显示已是最新。
- 如果宿主返回 \`restart-required\`，必须提示用户重启 DSH 后再次验证。

## 4. 约束
- 不修改与 Planners Form 无关的 profile 插件。
- 不把 token、cookie、Authorization、代理密码写进输出。
- 不关闭 TLS 校验、不使用来历不明的镜像。
- 不要反复重试同一条失败命令；每次失败先读错误再决定。

## 5. 输出
- 实际使用的更新方式（plugin_manager / CLI）。
- 更新前后的版本与 commit。
- 是否需要重启，以及验证结果。
- 若失败：错误原文、已恢复的备份路径、建议的下一步。
`;
}

/** Assemble the snapshot handed to either prompt. Pure and defensive. */
export function buildSnapshot({generatedAt, plugin, environment, review, paths, skills, job, lastSelfUpdate, errors}) {
  return {
    schema: SCHEMA,
    generatedAt: generatedAt ?? new Date().toISOString(),
    redacted: true,
    plugin: {
      version: plugin?.version ?? null,
      commit: plugin?.commit ?? null,
      mode: plugin?.mode ?? null,
      spec: plugin?.spec ?? null,
      profile: plugin?.profile ?? null,
      profileDir: plugin?.profileDir ?? null,
      latestVersion: plugin?.latestVersion ?? null,
      latestCommit: plugin?.latestCommit ?? null,
      ahead: plugin?.ahead === true,
      updateAvailable: plugin?.updateAvailable === true,
      canSelfUpdate: plugin?.canSelfUpdate === true,
    },
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      nodeReady: environment?.nodeReady !== false,
    },
    environment: {
      pythonReady: environment?.pythonReady === true,
      python: environment?.python ?? null,
      lastPythonError: scrub(clip(environment?.lastPythonError, 1200)) || null,
    },
    review: {ready: review?.ready === true},
    paths: {
      root: paths?.root ?? null,
      skills: paths?.skills ?? null,
      mounts: paths?.mounts ?? null,
      stateFile: paths?.stateFile ?? null,
      staging: paths?.staging ?? null,
      python: paths?.python ?? null,
    },
    skills: {
      installed: skills?.installed ?? {},
      updates: skills?.updates ?? {},
      checkErrors: skills?.checkErrors ?? {},
      rows: (skills?.rows ?? []).map(row => ({
        id: row.id,
        ownership: row.ownership ?? null,
        installedRevision: row.installedRevision ?? null,
        update: row.update ?? null,
        checkError: row.checkError === null || row.checkError === undefined ? null : scrub(clip(row.checkError, 600)),
      })),
    },
    job: {
      state: job?.state ?? null,
      message: scrub(clip(job?.message, 1200)) || null,
      logTail: scrub(clip(lines(job?.logTail), 4000)) || null,
    },
    lastSelfUpdate: lastSelfUpdate ?? null,
    errors: (errors ?? []).map(error => scrub(clip(error, 1200))).filter(Boolean),
  };
}
