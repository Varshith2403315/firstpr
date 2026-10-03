// app.js
// Wires the page together. All untrusted text (issue titles, bodies, paths)
// goes through textContent, never innerHTML.

import * as A from './analyze.js';
import { createClient, loadRepo, GitHubError } from './github.js';
import { drawTopo } from './topo.js';
import { walkthroughPrompt, reviewPrompt, askClaude, fullPrompt, renderMarkdown } from './guide.js';

const $ = (sel, root = document) => root.querySelector(sel);
drawTopo(document.getElementById('topo'));
const LANG_COLORS = ['var(--ink)', '#5c8a6e', '#c9a227', '#7c93b8', '#8e6c9e', '#c7d1cb'];
const CACHE_MS = 15 * 60 * 1000;

const state = { ctx: null, ranked: [], selected: null, showAll: false, username: '', level: 'first' };
const keys = { github: '', anthropic: '' };
const client = createClient(() => keys.github);

// ---------- tiny DOM helper ----------

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}
const code = (t) => h('code', { text: t });
const gh = (ctx, path) => `https://github.com/${ctx.owner}/${ctx.repo}/blob/${encodeURIComponent(ctx.ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;

function copyButton(getText) {
  const btn = $('#copy-tpl').content.firstElementChild.cloneNode(true);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.textContent = 'Copied';
      btn.classList.add('ok');
    } catch {
      btn.textContent = 'Select and copy';
    }
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1800);
  });
  return btn;
}

function relTime(iso) {
  const days = Math.round((Date.now() - Date.parse(iso)) / 864e5);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  if (days < 540) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

// ---------- keys panel ----------

const keysToggle = $('.keys-toggle');
keysToggle.addEventListener('click', () => {
  const open = keysToggle.getAttribute('aria-expanded') !== 'true';
  keysToggle.setAttribute('aria-expanded', String(open));
  $('#keys').hidden = !open;
});
$('#gh-token').addEventListener('input', (e) => { keys.github = e.target.value.trim(); });
$('#ai-key').addEventListener('input', (e) => { keys.anthropic = e.target.value.trim(); });
function openKeys(focusId) {
  keysToggle.setAttribute('aria-expanded', 'true');
  $('#keys').hidden = false;
  $(focusId).focus();
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---------- the form ----------

const form = $('#repo-form');
const input = $('#repo');
const errorEl = $('#repo-error');
const logEl = $('#log');
const results = $('#results');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = A.parseRepoInput(input.value);
  if (!parsed) return showError('Enter it as owner/repo, like fmtlib/fmt, or paste the GitHub link.');
  showError('');
  state.level = new FormData(form).get('level');
  run(parsed);
});
input.addEventListener('input', () => showError(''));

document.querySelectorAll('.try button').forEach((b) =>
  b.addEventListener('click', () => { input.value = b.dataset.repo; form.requestSubmit(); }));

form.querySelectorAll('input[name="level"]').forEach((r) =>
  r.addEventListener('change', () => {
    state.level = r.value;
    if (state.ctx) { rank(); renderRoute(false); }
  }));

// ---------- progress log ----------

const steps = new Map();
function step(id, text, done = false) {
  logEl.hidden = false;
  let li = steps.get(id);
  if (!li) { li = h('li'); steps.set(id, li); logEl.append(li); }
  li.textContent = text;
  li.className = done ? 'done' : 'busy';
}
function resetLog() { steps.clear(); logEl.replaceChildren(); logEl.hidden = true; }
function finishLog() { for (const li of steps.values()) if (li.className === 'busy') li.className = 'done'; }

// ---------- loading ----------

function cached(key) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
    return hit && Date.now() - hit.at < CACHE_MS ? hit.data : null;
  } catch { return null; }
}
function store(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full or blocked: fine */ }
}

async function run({ owner, repo }) {
  const go = $('.go');
  go.disabled = true;
  go.textContent = 'Mapping…';
  resetLog();
  const url = new URL(location.href);
  url.searchParams.set('repo', `${owner}/${repo}`);
  url.searchParams.set('level', state.level);
  history.replaceState(null, '', url);

  const key = `firstpr:${owner}/${repo}`.toLowerCase();
  try {
    let ctx = cached(key);
    if (ctx) step('cache', `Using the map of ${owner}/${repo} you loaded a few minutes ago`, true);
    else {
      ctx = await loadRepo(client, owner, repo, step);
      store(key, ctx);
    }
    finishLog();
    if (client.rate.remaining != null) step('rate', `${client.rate.remaining} of ${client.rate.limit} GitHub requests left this hour`, true);
    ctx.stack = A.detectStack(ctx.files, ctx.pkg);
    state.ctx = ctx;
    state.showAll = false;
    rank();
    renderRoute(true);
  } catch (err) {
    for (const li of steps.values()) if (li.className === 'busy') li.className = 'fail';
    if (err instanceof GitHubError && err.kind === 'rate-limit') {
      const at = new Date(err.reset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      step('err', `${err.message} It resets at ${at}. Add a GitHub token under Keys to keep going now.`);
    } else if (err instanceof GitHubError && err.kind === 'not-found') {
      showError(`${owner}/${repo}: ${err.message}`);
    } else {
      step('err', err.message || 'Something went wrong while reading the repository.');
    }
    const last = [...steps.values()].pop();
    if (last) last.className = 'fail';
    console.error(err);
  } finally {
    go.disabled = false;
    go.textContent = 'Map this repo';
  }
}

function rank() {
  state.ranked = A.rankIssues(state.ctx.issues, state.level);
  const pick = state.ranked.find((r) => !r.rating.assigned) || state.ranked[0];
  state.selected = pick ? pick.issue.number : null;
}

// ---------- the route ----------

function renderRoute(scroll) {
  const ctx = state.ctx;
  const { meta } = ctx;
  const facts = [
    `${meta.stargazers_count.toLocaleString('en-IN')} stars`,
    `last commit ${relTime(meta.pushed_at)}`,
    meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? `${meta.license.spdx_id} licence` : null,
  ].filter(Boolean);

  const head = h('header', { class: 'repo-head' },
    h('h2', {}, h('a', { href: meta.html_url, target: '_blank', rel: 'noopener' },
      h('span', { class: 'owner', text: `${ctx.owner}/` }), ctx.repo)),
    h('p', { text: [meta.description && (/[.!?]$/.test(meta.description.trim()) ? meta.description.trim() : `${meta.description.trim()}.`), `${facts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`].filter(Boolean).join(' ') }),
  );

  const trail = h('ol', { class: 'trail' },
    stopMap(ctx), stopIssues(ctx), stopSetup(ctx), stopChange(ctx), stopPR(ctx));

  const again = h('p', { class: 'again' },
    h('button', { type: 'button', class: 'btn ghost', onclick: () => { input.select(); input.focus(); window.scrollTo({ top: 0 }); } }, 'Map another repo'));

  results.replaceChildren(h('div', { class: 'route' }, head, trail, again));
  results.hidden = false;
  results.classList.toggle('settled', !scroll);
  if (scroll) results.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function stop(id, title, intro, ...body) {
  return h('li', { class: 'stop', id: `stop-${id}` }, h('h3', { text: title }), intro ? h('p', { class: 'stop-intro', text: intro }) : null, ...body);
}

// 1. the map
function stopMap(ctx) {
  const langs = A.languageShares(ctx.languages);
  const dirs = A.mapDirectories(ctx.files);
  const max = Math.max(...dirs.map((d) => d.count));
  const reads = A.startHere(ctx.files, ctx.repo);

  return stop('map', 'Read the map',
    `${ctx.files.length.toLocaleString('en-IN')} files. Here is how they are laid out and where to start reading.`,
    langs.length ? h('div', {},
      h('div', { class: 'langs', role: 'img', 'aria-label': langs.map((l) => `${l.name} ${Math.round(l.share * 100)}%`).join(', ') },
        langs.map((l, i) => h('span', { style: `width:${(l.share * 100).toFixed(2)}%;background:${LANG_COLORS[l.name === 'Other' ? 5 : i % 5]}` }))),
      h('ul', { class: 'lang-key' }, langs.map((l, i) =>
        h('li', {}, h('i', { style: `background:${LANG_COLORS[l.name === 'Other' ? 5 : i % 5]}` }), `${l.name} ${l.share < 0.01 ? '<1' : Math.round(l.share * 100)}%`)))) : null,
    h('h4', { text: 'Folders, sized by how many files they hold' }),
    h('div', { class: 'plots' }, dirs.map((d) =>
      h('div', { class: `plot${d.isRest ? ' rest' : ''}`, style: `--w:${Math.max(1, Math.round((d.count / max) * 10))};--t:${(0.15 + 0.55 * (d.count / max)).toFixed(2)}` },
        h('b', { text: d.isRoot || d.isRest ? d.name : `${d.name}/` }),
        h('span', { class: 'n', text: `${d.count.toLocaleString('en-IN')} file${d.count === 1 ? '' : 's'}` }),
        h('p', { text: d.role })))),
    reads.length ? [h('h4', { text: 'Start reading here' }),
      h('ul', { class: 'reads' }, reads.map((r) =>
        h('li', {}, h('a', { href: gh(ctx, r.path), target: '_blank', rel: 'noopener', text: r.path }), h('span', { text: r.why }))))] : null,
    h('h4', { text: 'How ready is it for newcomers?' }),
    h('ul', { class: 'checks' }, A.readiness(ctx.files).map((c) =>
      h('li', { class: c.ok ? 'yes' : 'no' }, h('span', {}, h('strong', { text: c.label }), c.ok ? c.yes : c.no)))),
  );
}

// 2. issues
function stopIssues(ctx) {
  const list = state.ranked;
  if (!list.length) {
    return stop('issues', 'Pick an issue', null,
      h('div', { class: 'empty' },
        h('p', { text: 'There are no open issues here that suit a first contribution right now.' }),
        h('p', {}, 'You can still help: fix a typo in the docs, improve an error message, or ',
          h('a', { href: `${ctx.meta.html_url}/discussions`, target: '_blank', rel: 'noopener', text: 'ask in Discussions' }),
          ' what the maintainers need. Or map a different repo.')));
  }
  const intro = ctx.issueSource === 'labelled'
    ? `Sorted by how well each one fits where you are starting from. The maintainers labelled these ${ctx.labelsUsed.map((l) => `“${l}”`).join(' or ')}.`
    : `This repo does not label newcomer issues, so these are open issues with quiet threads. Read each one carefully.`;
  const shown = state.showAll ? list : list.slice(0, 6);

  const ul = h('ul', { class: 'issues' }, shown.map(({ issue, rating }) =>
    h('li', {}, h('button', {
      type: 'button', class: 'issue', 'aria-pressed': String(issue.number === state.selected),
      onclick: () => { state.selected = issue.number; renderRoute(false); $('#stop-change')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    },
    h('span', { class: 'issue-top' },
      h('span', { class: 'issue-title' }, h('span', { class: 'issue-num', text: `#${issue.number}` }), issue.title),
      h('span', { class: `grade ${rating.grade.key}`, title: `Difficulty ${rating.difficulty} of 5` },
        h('i'), rating.grade.key === 'scramble' ? h('i') : null, rating.grade.name)),
    h('span', { class: 'issue-fit' }, h('strong', { text: rating.verdict }), `. Opened ${relTime(issue.created_at)}, ${issue.comments} comment${issue.comments === 1 ? '' : 's'}.`),
    rating.notes.length ? h('ul', { class: 'issue-notes' }, rating.notes.map((n) => h('li', { class: n.tone, text: n.text }))) : null,
    rating.labels.length ? h('span', { class: 'tags' }, rating.labels.slice(0, 5).map((l) => h('span', { text: l }))) : null,
    ))));

  return stop('issues', 'Pick an issue', intro, ul,
    list.length > 6 ? h('button', { type: 'button', class: 'more', onclick: () => { state.showAll = !state.showAll; renderRoute(false); } },
      state.showAll ? 'Show fewer' : `Show all ${list.length}`) : null);
}

// 3. setup
function setupScript(ctx) {
  const user = state.username || 'YOUR-USERNAME';
  const s = ctx.stack;
  const lines = [
    `# Fork it first: ${ctx.meta.html_url}/fork`,
    `git clone https://github.com/${user}/${ctx.repo}.git`,
    `cd ${ctx.repo}`,
    `git remote add upstream ${ctx.meta.clone_url}`,
    '',
    `# Build (${s.name})`,
    ...s.build,
  ];
  if (s.test.length) lines.push('', '# Run the tests once before you change anything', ...s.test);
  return lines.join('\n');
}

function shellBlock(text) {
  const pre = h('pre');
  const codeEl = h('code');
  for (const line of text.split('\n')) {
    codeEl.append(line.startsWith('#') ? h('span', { class: 'c', text: line }) : line, '\n');
  }
  pre.append(codeEl);
  return h('div', { class: 'cmds' }, pre, copyButton(() => text));
}

function stopSetup(ctx) {
  const userField = h('label', { class: 'field', style: 'max-width:20rem;margin-bottom:1rem' },
    h('span', { text: 'Your GitHub username' }),
    h('small', { class: 'field-hint', text: 'Fills it into the commands below.' }),
    h('input', {
      type: 'text', value: state.username, placeholder: 'octocat', autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => {
        state.username = e.target.value.trim().replace(/^@/, '');
        const fresh = shellBlock(setupScript(ctx));
        $('#stop-setup .cmds').replaceWith(fresh);
        const pr = $('#stop-pr .cmds');
        if (pr) pr.replaceWith(shellBlock(prScript(ctx, currentIssue())));
        const link = $('#start-pr');
        if (link) link.href = compareUrl(ctx, currentIssue());
      },
    }));
  return stop('setup', 'Get it running on your machine',
    'Fork, clone and build before touching any code. If the tests pass now, you will know any failure later is yours to look at.',
    userField, shellBlock(setupScript(ctx)), ctx.stack.note ? h('p', { class: 'note', text: ctx.stack.note }) : null);
}

// 4. the change
const currentIssue = () => state.ranked.find((r) => r.issue.number === state.selected)?.issue || null;

function stopChange(ctx) {
  const issue = currentIssue();
  if (!issue) return stop('change', 'Make the change', null, h('p', { class: 'pick-first', text: 'Pick an issue above and this fills in.' }));
  const matches = A.likelyFiles(issue, ctx.files, 5, ctx.repo);
  const branch = A.branchFor(issue);

  const fileList = matches.files.length
    ? h('ul', { class: 'touch' }, matches.files.map((f) =>
      h('li', {}, h('a', { href: gh(ctx, f.path), target: '_blank', rel: 'noopener', text: f.path }),
        h('span', {}, 'The issue mentions ', ...f.why.flatMap((w, i) => [i ? ', ' : '', code(w)]), '.'))))
    : h('p', { class: 'note' }, 'No file names in the issue matched the tree. Search the code for a distinctive word from the issue instead: ',
      code(`git grep -n "${(issue.title.match(/[A-Za-z_]\w{4,}/g) || ['keyword']).sort((a, b) => b.length - a.length)[0]}"`));

  return stop('change', 'Make the change',
    null,
    h('p', { class: 'stop-intro' }, 'Working on ', h('a', { href: issue.html_url, target: '_blank', rel: 'noopener', text: `#${issue.number} ${issue.title}` }),
      '. Leave a short comment on the issue saying you are taking it, then start a branch:'),
    shellBlock(`git switch -c ${branch}`),
    h('h4', { text: 'Files you will probably touch' }),
    fileList,
    matches.tests.length ? [h('h4', { text: 'Tests to update or copy from' }),
      h('ul', { class: 'touch' }, matches.tests.map((t) => h('li', {}, h('a', { href: gh(ctx, t), target: '_blank', rel: 'noopener', text: t }))))] : null,
    guideBox({
      heading: 'Not sure where to begin?',
      title: 'Walk me through it',
      hint: 'Reads the issue and the top matching files, then explains the fix in plain steps.',
      build: async () => {
        const snippets = [];
        for (const f of matches.files.slice(0, 2)) {
          const text = await client.raw(ctx.owner, ctx.repo, ctx.ref, f.path);
          if (text) snippets.push({ path: f.path, text });
        }
        return walkthroughPrompt(ctx, issue, matches, snippets);
      },
    }));
}

function guideBox({ heading, title, hint, build, extra = null, needs = () => '' }) {
  const out = h('div', { class: 'prose', 'aria-live': 'polite' });
  const ask = h('button', { type: 'button', class: 'btn' }, title);
  const copy = h('button', { type: 'button', class: 'btn ghost' }, 'Copy prompt');

  ask.addEventListener('click', async () => {
    const missing = needs();
    if (missing) { out.innerHTML = `<p class="err">${missing}</p>`; return; }
    if (!keys.anthropic) {
      out.innerHTML = '<p>Add an Anthropic API key under Keys to run this here, or use <strong>Copy prompt</strong> and paste it into any AI chat.</p>';
      openKeys('#ai-key');
      return;
    }
    ask.disabled = true;
    ask.textContent = 'Thinking…';
    out.innerHTML = '';
    try {
      out.innerHTML = renderMarkdown(await askClaude(keys.anthropic, await build()));
    } catch (err) {
      out.replaceChildren(h('p', { class: 'err', text: err.message }));
    } finally {
      ask.disabled = false;
      ask.textContent = title;
    }
  });

  copy.addEventListener('click', async () => {
    const missing = needs();
    if (missing) { out.innerHTML = `<p class="err">${missing}</p>`; return; }
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(fullPrompt(await build()));
      copy.textContent = 'Copied. Paste it into any AI chat';
    } catch {
      copy.textContent = 'Copy failed';
    }
    copy.disabled = false;
    setTimeout(() => { copy.textContent = 'Copy prompt'; }, 2500);
  });

  return h('div', { class: 'guide' },
    h('div', { class: 'guide-head' }, h('h4', { text: heading }), ask, copy),
    h('p', { class: 'guide-hint', text: hint }),
    extra, out);
}

// 5. the pull request
function prScript(ctx, issue) {
  const branch = A.branchFor(issue);
  const summary = issue.title.replace(/"/g, "'").slice(0, 60);
  return [
    '# Check the whole diff once more',
    `git diff upstream/${ctx.ref}`,
    '',
    `git add -A`,
    `git commit -m "${summary} (#${issue.number})"`,
    `git push -u origin ${branch}`,
  ].join('\n');
}

function compareUrl(ctx, issue) {
  const branch = A.branchFor(issue);
  return state.username
    ? `${ctx.meta.html_url}/compare/${encodeURIComponent(ctx.ref)}...${encodeURIComponent(state.username)}:${encodeURIComponent(branch).replace(/%2F/g, "/")}?expand=1`
    : `${ctx.meta.html_url}/compare`;
}

function stopPR(ctx) {
  const issue = currentIssue();
  const li = issue
    ? (() => {
      const matches = A.likelyFiles(issue, ctx.files, 5, ctx.repo);
      const desc = A.prDescription(issue, matches.files.slice(0, 3).map((f) => f.path));
      const diffBox = h('textarea', { placeholder: `Paste the output of: git diff upstream/${ctx.ref}`, 'aria-label': 'Your diff' });
      return stop('pr', 'Open the pull request',
        'Commit, push to your fork, and open the PR. Have your diff checked first so the maintainer’s first impression is a good one.',
        shellBlock(prScript(ctx, issue)),
        guideBox({
          heading: 'Check your change first',
          title: 'Review my diff',
          hint: 'Checks whether the change solves the issue, spots problems, and asks about tests, the way a maintainer would.',
          extra: diffBox,
          needs: () => (diffBox.value.trim() ? '' : 'Paste your diff into the box first.'),
          build: async () => reviewPrompt(ctx, issue, diffBox.value),
        }),
        h('h4', { text: 'Your PR description' }),
        h('div', { class: 'prbox' }, h('pre', { text: desc }), copyButton(() => desc)),
        h('div', { class: 'finish-line' },
          h('a', { class: 'btn', id: 'start-pr', href: compareUrl(ctx, issue), target: '_blank', rel: 'noopener' }, 'Start the pull request on GitHub'),
          h('a', { class: 'btn ghost', href: issue.html_url, target: '_blank', rel: 'noopener' }, 'Back to the issue')));
    })()
    : stop('pr', 'Open the pull request', null, h('p', { class: 'pick-first', text: 'Pick an issue above and this fills in.' }));
  li.classList.add('finish');
  return li;
}

// ---------- start from a shared link ----------

const params = new URLSearchParams(location.search);
if (params.get('level')) {
  const r = form.querySelector(`input[name="level"][value="${CSS.escape(params.get('level'))}"]`);
  if (r) { r.checked = true; state.level = r.value; }
}
if (params.get('repo')) {
  input.value = params.get('repo');
  form.requestSubmit();
}
