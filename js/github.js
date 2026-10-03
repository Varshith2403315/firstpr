// github.js
// Talks to the public GitHub REST API straight from the browser.
// Without a token GitHub allows 60 requests an hour per IP; one repo costs about 6.

import { STARTER_LABEL, HELP_LABEL } from './analyze.js';

export class GitHubError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export function createClient(getToken = () => '') {
  const rate = { remaining: null, limit: null, reset: null };

  async function api(path) {
    const token = getToken();
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      throw new GitHubError('offline', 'Could not reach GitHub. Check your connection and try again.');
    }
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) {
      rate.remaining = Number(rem);
      rate.limit = Number(res.headers.get('x-ratelimit-limit'));
      rate.reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    }
    if (res.status === 401) throw new GitHubError('bad-token', 'GitHub rejected the token. Check it, or clear it to browse without one.');
    if ((res.status === 403 || res.status === 429) && rate.remaining === 0) {
      throw new GitHubError('rate-limit', 'GitHub’s hourly limit for this network is used up.', { reset: rate.reset });
    }
    if (res.status === 404) throw new GitHubError('not-found', 'That repository does not exist, or it is private.');
    if (!res.ok) throw new GitHubError('http', `GitHub answered with an error (${res.status}). Try again in a minute.`);
    return res.json();
  }

  // raw.githubusercontent.com does not count against the API limit.
  async function raw(owner, repo, ref, path) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`);
      return res.ok ? res.text() : null;
    } catch {
      return null;
    }
  }

  return { api, raw, rate };
}

export async function loadRepo(client, owner, repo, step = () => {}) {
  const base = `/repos/${owner}/${repo}`;

  step('repo', `Finding ${owner}/${repo}`);
  const meta = await client.api(base);
  const ref = meta.default_branch;

  step('tree', `Reading every file path on ${ref}`);
  const [languages, tree] = await Promise.all([
    client.api(`${base}/languages`),
    client.api(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`),
  ]);
  const files = tree.tree.filter((n) => n.type === 'blob').map((n) => n.path);
  step('tree', `Read ${files.length.toLocaleString('en-IN')} file paths${tree.truncated ? ' (GitHub cut the list short; this repo is huge)' : ''}`, true);

  step('issues', 'Looking for issues marked for newcomers');
  const labels = (await client.api(`${base}/labels?per_page=100`)).map((l) => l.name);
  const starter = labels.filter((n) => STARTER_LABEL.test(n)).slice(0, 3);
  const helping = labels.filter((n) => HELP_LABEL.test(n) && !STARTER_LABEL.test(n)).slice(0, 1);

  const byNumber = new Map();
  for (const name of [...starter, ...helping]) {
    const list = await client.api(`${base}/issues?state=open&per_page=30&labels=${encodeURIComponent(name)}`);
    for (const i of list) if (!i.pull_request) byNumber.set(i.number, i);
  }
  let issueSource = 'labelled';
  if (!byNumber.size) {
    issueSource = 'recent';
    const list = await client.api(`${base}/issues?state=open&per_page=40&sort=updated`);
    for (const i of list) if (!i.pull_request && i.comments < 6) byNumber.set(i.number, i);
  }
  const issues = [...byNumber.values()];
  step('issues', issues.length
    ? `Found ${issues.length} open ${issueSource === 'labelled' ? `issues labelled ${[...starter, ...helping].map((l) => `“${l}”`).join(', ')}` : 'issues with quiet threads (no newcomer labels here)'}`
    : 'No open issues to suggest', true);

  let pkg = null;
  if (files.includes('package.json')) {
    try { pkg = JSON.parse(await client.raw(owner, repo, ref, 'package.json')); } catch { pkg = null; }
  }

  return { owner, repo, meta, ref, languages, files, truncated: !!tree.truncated, issues, issueSource, labelsUsed: [...starter, ...helping], pkg };
}
