// Quota-free upstream lookups.
//
// GitHub's REST API allows 60 unauthenticated requests per hour per egress IP.
// A settings page that checks a handful of Skills, behind a shared proxy, burns
// that in a few clicks and every check then answers 403. The endpoints used
// here are the ones git itself and the release feed use; neither is subject to
// that quota. The REST API remains only as a last resort.

const SHA = /^[a-f0-9]{40}$/;
const REPO = /^thePlannerIvan\/[A-Za-z0-9_.-]+$/;
const CHANNEL = /^[A-Za-z0-9._/-]+$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const DEFAULT_TIMEOUT_MS = 8000;

function assertRepo(repo) {
  if (typeof repo !== 'string' || !REPO.test(repo)) throw new Error(`无效的发布来源：${repo}`);
}

function assertChannel(channel) {
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) throw new Error(`无效的分支名：${channel}`);
}

async function text(fetcher, url, {timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}} = {}) {
  const response = await fetcher(url, {
    headers: {'user-agent': 'planners-form', accept: '*/*', ...headers},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

/** Parse one semver string, or null when it is not plain semver. */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value.trim());
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Compare two semver strings: negative / 0 / positive, or null when either is not semver. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numeric = /^\d+$/.test(x);
    const otherNumeric = /^\d+$/.test(y);
    if (numeric && otherNumeric) return Number(x) - Number(y);
    if (numeric !== otherNumeric) return numeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Resolve the commit `channel` currently points at.
 *
 * 1. git's own ref advertisement (`info/refs?service=git-upload-pack`), the
 *    same call `git ls-remote` makes. No API quota, no git binary needed.
 * 2. The commits Atom feed, which also carries full SHAs and no API quota.
 * 3. The REST API, only when both are unavailable.
 */
export async function resolveCommit(repo, channel = 'main', {fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  assertRepo(repo);
  assertChannel(channel);
  const notes = [];

  try {
    const body = await text(fetcher, `https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      timeoutMs,
      headers: {'user-agent': 'git/2.40.0'},
    });
    if (body.includes('# service=git-upload-pack') || body.includes('refs/heads/')) {
      const quoted = channel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const found = new RegExp(`([0-9a-f]{40}) refs/heads/${quoted}(?=$|[\\s\\0])`, 'u').exec(body);
      if (found !== null && SHA.test(found[1])) return found[1];
    }
    notes.push('refs 未包含该分支');
  } catch (error) {
    notes.push(`refs: ${error.message}`);
  }

  try {
    const body = await text(fetcher, `https://github.com/${repo}/commits/${encodeURIComponent(channel)}.atom`, {timeoutMs});
    const found = /<id>tag:github\.com,2008:Grit::Commit\/([a-f0-9]{40})<\/id>/u.exec(body);
    if (found !== null) return found[1];
    notes.push('atom 未包含提交');
  } catch (error) {
    notes.push(`atom: ${error.message}`);
  }

  try {
    const body = await text(fetcher, `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(channel)}`, {
      timeoutMs,
      headers: {accept: 'application/vnd.github+json'},
    });
    const data = JSON.parse(body);
    if (SHA.test(data?.sha)) return data.sha;
    notes.push('api 未返回提交');
  } catch (error) {
    notes.push(`api: ${error.message}`);
  }

  throw new Error(`无法解析 ${repo} 的最新提交（${notes.join('；')}）`);
}

function decodeXml(value) {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

/**
 * Resolve the newest published release of `repo`.
 * @returns {Promise<{tag: string, version: string, publishedAt: string|null}>}
 */
export async function resolveRelease(repo, {fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  assertRepo(repo);
  const notes = [];

  try {
    const body = await text(fetcher, `https://github.com/${repo}/releases.atom`, {timeoutMs});
    const entries = body.split('<entry>').slice(1);
    for (const entry of entries) {
      const id = /<id>tag:github\.com,2008:Repository\/\d+\/([^<]+)<\/id>/u.exec(entry);
      if (id === null) continue;
      const tag = decodeXml(id[1].trim());
      const version = tag.replace(/^v/u, '');
      const published = /<updated>([^<]+)<\/updated>/u.exec(entry);
      if (parseVersion(version) !== null) return {tag, version, publishedAt: published === null ? null : published[1]};
    }
    notes.push('releases.atom 没有可识别的版本');
  } catch (error) {
    notes.push(`releases: ${error.message}`);
  }

  try {
    const body = await text(fetcher, `https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      timeoutMs,
      headers: {'user-agent': 'git/2.40.0'},
    });
    let newest = null;
    for (const match of body.matchAll(/refs\/tags\/([^\s^]+)/gu)) {
      const tag = match[1];
      const version = tag.replace(/^v/u, '');
      if (parseVersion(version) === null) continue;
      if (newest === null || compareVersions(version, newest.version) > 0) newest = {tag, version, publishedAt: null};
    }
    if (newest !== null) return newest;
    notes.push('refs 标签里没有可识别的版本');
  } catch (error) {
    notes.push(`tags: ${error.message}`);
  }

  throw new Error(`无法解析 ${repo} 的最新版本（${notes.join('；')}）`);
}
