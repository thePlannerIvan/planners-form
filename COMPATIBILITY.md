# Compatibility record

Checked: 2026-10-20

## 0.2.0 — latest-tracking installs, self-update, diagnostic prompt (2026-10-20)

0.2.0 changes where versions come from and what the settings page can repair:

- **No pinned revisions.** `catalog.json` is metadata only (schema 2). Every install and update resolves the repository's current `main` commit at action time through `lib/upstream.js`: git's ref advertisement first, commits Atom second, REST API only as a last resort. The REST API's 60-requests-per-hour unauthenticated limit is no longer on the critical path; the previous behaviour produced `403` for every package behind a shared proxy.
- **Checks no longer block updates.** Checks cover only installed Skills plus the plugin itself, report per-item errors, and never gate `update`/`update-all`. A single unreachable repository skips that item instead of failing the whole run.
- **Plugin self-update.** When the host exposes the official `pluginManager` service, the settings page calls `installBundle('github:thePlannerIvan/planners-form#<sha>')`, which owns the pnpm call, the profile lock, the manifest/lock backup and HMR re-composition. Otherwise the page offers a copyable update prompt for the user's agent (`plugin_manager` tool or the application's bundled CLI). Desktop requires a restart for a fully applied update.
- **Diagnostic prompt.** `POST {"action":"diagnose","kind":"fix"|"update"}` returns a paste-ready prompt plus a redacted snapshot (plugin/profile/paths/environments/skills/job/network-facing errors). Tokens, cookies and credential-shaped strings are stripped; absolute paths and recent logs are included by design because the user explicitly copies the text. The repair prompt ends with an email fallback to Lawyif@163.com for cases the agent cannot fix or optimization findings.
- **Profile discovered from the install path.** The plugin process does not inherit `DSH_PROFILE`/`DSH_PROFILE_DIR`; 0.2.0 derives the profile from `<…>/profiles/<name>/node_modules/…` (including pnpm virtual-store layouts) and falls back to scanning `$DSH_HOME/profiles`, so the prompt no longer reports `profile: unknown`/`mode: unknown`. A locally installed build that is newer than the latest release is reported as `ahead` (本地预览版) instead of looking updateable.
- **Bundled Review Dock 0.2.5.** The vendored dock moves 0.2.4 → 0.2.5 (same-origin review frames) and the stale `0.2.3` marker in `package-lock.json` is corrected.

Verification performed for this release (no paid model requests):

| Check | Result |
|---|---|
| `npm test` | 56 tests: 55 pass, 1 skipped (`DSH_TEST_RUNTIME` integration), 0 fail |
| `npm run check` | all `lib/*.js` parse |
| Live resolver, real network | `resolveCommit('thePlannerIvan/planners-form','main')` → `3ab093c…`; `resolveRelease` → `v0.1.4`; no `api.github.com` quota consumed |
| Install/update/repair plan | latest resolution used for install/update; repair restores the recorded revision; external installs untouched |
| Self-update delegation | unit-tested with a stubbed host `installBundle` (spec `github:…#<sha>`, result recorded in `state.json`, failure leaves the previous install intact) |
| Settings UI | renders plugin version row, self-update/update-prompt/diagnose controls; hidden companion Skills stay hidden |

Not yet verified live: an actual self-update against the running desktop host (needs a published newer commit and a restart), the bundled-CLI fallback path with sandbox approvals, and the diagnostic prompt being executed end-to-end by an agent. Those are recorded as follow-ups rather than claimed results.

## Release target: DSH 0.2.x

The release manifest declares `peerDependencies["@deepseek-ai/dsh"] = "^0.2.0-rc.2"` and `engines.dsh = "^0.2.0-rc.2"`. DSH's compatibility evaluator prefers `engines.dsh` when present and otherwise checks every `@deepseek-ai/dsh*` peer with prereleases participating in ranges, so 0.2.0-rc.2 and the rest of the 0.2 line are accepted while 0.3.0 is not. **0.1.3 declared the runtime back as an exact pin (`"0.2.0-rc.2"`), which is what made 0.2.1-rc.1 skip the whole bundle at profile load** — the plugin code was never the problem.

### 0.2.1-rc.1 live verification (2026-10-17)

The installed official DeepSeek Harness desktop application identifies itself as 0.2.1-rc.1; its bundled CLI reports the same version and the server runs on the application's bundled Node 24.21.0. A copy of the 0.1.3 tree with only the manifest change above was installed with `dsh plugin --profile probe add <dir> --offline` into an isolated DSH_HOME, then the Web app booted on the composed profile (no model API key, no paid request).

| Check | Result |
|---|---|
| Compatibility gate at profile load | `planners-form` + `planners-form-local-skills` rows present; nothing skipped |
| `GET /` | 303 to tokenized URL, cookie set; with cookie HTTP 200 (HTML) |
| `GET /api/planners-form` | HTTP 200; `reviewReady: true`, token present, 15 catalog rows, managed review-core |
| POST token + same-origin fence | 200 with token; 403 without token; 403 for `Sec-Fetch-Site: cross-site` |
| `POST {"action":"check"}` | HTTP 200; GitHub reachable and update detected |
| Review routes | `review.bridge` 200 (bytes = Core bridge), `review.page` 200 with bridge inlined, `surface`/`draft`/`write` 200 and files landed, `current`/`wake` 400 for missing session, unknown route 404 |
| Client bundle | HTTP 200 and contains the Planners Form page |
| Runtime errors | none; plugin apply did not trigger an install job |

Limits: the test reused an existing review-core through a read-only copy inside the isolated DSH_HOME, so a clean-machine GitHub codeload download is not part of this run; no UI click-through or screenshot; PPT Python/Chromium and video rendering tools are not exercised. The running `desktop` profile is owned by the Electron app and was not booted or modified by this test.

### 0.2.0-rc.2 record (2026-10-13)

The runtime was extracted from the installed official DeepSeek Harness desktop application's `app.asar` into an isolated temporary directory. Both its CLI and desktop-runtime package identify themselves as 0.2.0-rc.2. The server ran using the application's bundled Node, which reported 24.21.0.

The actual Planners Form `.tgz` was installed with this runtime's `dsh plugin --profile web add <tgz> --offline` into a new DSH_HOME. The CLI completed successfully and added the bundle automatically.

Live results:

| Check | Result |
|---|---|
| Official plugin compatibility evaluator | Accepted 0.2.0-rc.2 |
| Settings section | Planners Form appeared and rendered |
| Business name + invocation name | Both visible |
| Authenticated settings status | HTTP 200 |
| Same-origin repair action | HTTP 202, job completed |
| Review Bridge | HTTP 200, ReviewBridge code returned |
| Unknown route control | HTTP 404 |

The live test reused an existing review-core through a link inside the isolated DSH_HOME. This tests plugin/runtime integration; it does not prove GitHub download success on a clean machine. No model API key or paid model request was used, so generated-content feedback/wake end-to-end is not a claimed result.

## 0.2.1 alpha source check (historical)

Official tags checked: `dsh-v0.2.1-alpha.1`, `dsh-v0.2.1-alpha.2`. The settings contract file `packages/client/ui-settings/src/client/contract/slots.ts` had the identical Git blob SHA `d04ac21fa606fe4dc0af75dee0bae4b60fb299a7` in rc.2 and both alphas. That established only one interface's stability; it is superseded by the 0.2.1-rc.1 live verification above.

## Additional checks and limits

33 automated tests cover the install/update manager, archive extraction, external installation preservation, dependency closure, recovery after interruption, and authenticated HTTP handling. Earlier UI development also ran on DSH 0.1.7-rc.1; that version is not in this release's supported range.

Initial direct GitHub/npm connections failed with TLS errors. The subsequent 0.1.1 verification successfully accessed all five newly public repositories without authentication and installed the actual proposal, bypage and video dependency closure in an empty DSH_HOME (11 Skills). Companion Skill mounts and frontmatter identifiers were checked. The plugin archive bundles its Node dependencies. PPT Python/browser provisioning, Video Craft rendering tools, native desktop plugin-manager installation, and Windows still require separate validation.

The 0.1.1 catalog pins the five newly public repositories to audited commits. Settings hides `sparkling`, `storytelling` and `slide-copy` in both lists, while dependency installation and updates still include them.

## 0.1.2 Git installation fix

0.1.1 Release-package checks did not cover Git source installation. The source archive lacked dependencies marked as bundled, causing entry import failure. 0.1.2 includes the production dependencies and adds a Git archive import test without inherited developer dependencies.

## 0.1.3 Skill discovery fix

Settings now uses the DSH skill registry rather than a single hardcoded directory. A native filesystem provider makes local DSH/Agent roots visible even when the profile disables its default provider. The rc.2 integration test covers custom-root discovery, an overridden agents home, existing-install preservation, and immediate loading of a freshly installed Skill through the actual registry. Installed rows display ✅; Review Dock resolves the discovered core location. Project/preset-private Skills are not presented as global installations.
