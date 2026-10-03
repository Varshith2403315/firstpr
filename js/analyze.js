// analyze.js
// Everything here is a pure function: no DOM, no network.
// That keeps the heuristics easy to test from Node (see test/analyze.test.mjs).

export const STARTER_LABEL = /good.?first|beginner|first.?timer|starter|newcomer|easy|trivial|low.?hanging|up.?for.?grabs/i;
export const HELP_LABEL = /help.?wanted|contributions?.?welcome|pr.?welcome/i;

const IGNORED_DIR = /(^|\/)(node_modules|vendor|third_party|third-party|thirdparty|external|extern|deps|dist|build|out|target|\.git)\//i;
const NOT_CODE = /\.(png|jpe?g|gif|svg|ico|webp|bmp|pdf|woff2?|ttf|otf|eot|zip|gz|tar|lock|bin|dat|mp4|mp3|wav)$/i;
const TEST_PATH = /(^|\/)(tests?|spec|__tests__|testing)(\/|$)|[._-](test|spec)\.[a-z]+$|^test_|\/test_[^/]+$/i;
const DOCS_PATH = /(^|\/)(docs?|documentation)(\/|$)|\.(md|rst|txt)$/i;
const EXAMPLE_PATH = /(^|\/)(examples?|samples?|demos?)(\/|$)/i;

const STOP = new Set(`
the and for with that this from have when what which there their would should could about into after before
because while where your just like does dont doesnt cant cannot will been were being make made more than then
them they also only some such other these those very need needs using used issue issues error errors file files
code function functions work works working return returns value values support supports add adds added fix fixes
fixed feature bug problem expected actual behavior behaviour version example examples please thanks thank
currently instead seems maybe something anything however since though still even case cases change changes
changed first second line lines output input type types running build builds should would github https http
describe description steps reproduce reproduction context additional information environment system
`.split(/\s+/).filter(Boolean));

const LANG_BY_EXT = {
  c: 'C', h: 'C/C++ headers', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++ headers', hh: 'C++ headers', ipp: 'C++',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', cs: 'C#', swift: 'Swift',
  md: 'Markdown', rst: 'reStructuredText', json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', cmake: 'CMake',
  sh: 'shell scripts', html: 'HTML', css: 'CSS', scss: 'Sass',
};

const DIR_ROLES = [
  [/^(src|source|lib|core)$/i, 'Main source code. Most fixes land here.'],
  [/^include$/i, 'Public headers: the API other code sees.'],
  [/^(tests?|spec|__tests__|testing)$/i, 'Tests. Run them before and after your change.'],
  [/^(docs?|documentation|site|website)$/i, 'Documentation. A friendly place for a first change.'],
  [/^(examples?|samples?|demos?)$/i, 'Usage examples. Read these to see the API in action.'],
  [/^(bench|benchmarks?|perf)$/i, 'Performance benchmarks.'],
  [/^cmake$/i, 'CMake helpers used by the build.'],
  [/^\.github$/i, 'CI workflows and issue templates.'],
  [/^(scripts?|tools?|utils?|support|ci)$/i, 'Helper scripts for building, testing or releasing.'],
  [/^(third_party|third-party|vendor|external|extern|deps)$/i, 'Bundled dependencies. Usually best left alone.'],
  [/^(packages|crates|modules)$/i, 'Separate packages in one repo. Pick the one your issue touches.'],
  [/^(apps?|cmd|bin)$/i, 'Runnable programs and entry points.'],
  [/^(public|static|assets|resources|res)$/i, 'Static files: images, fonts, data.'],
  [/^(config|conf|configs)$/i, 'Configuration.'],
  [/^(fuzz|fuzzing)$/i, 'Fuzz tests that throw random input at the code.'],
];

// ---------- input ----------

export function parseRepoInput(raw) {
  if (!raw) return null;
  let s = String(raw).trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+)/);
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

// ---------- small helpers ----------

const extOf = (p) => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
};
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const depthOf = (p) => p.split('/').length - 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const labelNames = (issue) => (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name || '')).filter(Boolean);

function dominantExt(files) {
  const counts = new Map();
  for (const f of files) {
    const e = extOf(f);
    if (e) counts.set(e, (counts.get(e) || 0) + 1);
  }
  let best = null;
  for (const [e, n] of counts) if (!best || n > best.n) best = { ext: e, n };
  return best ? { ext: best.ext, share: best.n / files.length } : null;
}

// ---------- the map ----------

export function mapDirectories(files, max = 10) {
  const groups = new Map();
  for (const f of files) {
    const i = f.indexOf('/');
    const key = i === -1 ? '' : f.slice(0, i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const all = [...groups.entries()].map(([name, list]) => {
    const dom = dominantExt(list);
    let role;
    if (!name) role = 'Project files: readme, licence and build setup.';
    else {
      const hit = DIR_ROLES.find(([re]) => re.test(name));
      if (hit) role = hit[1];
      else if (dom && LANG_BY_EXT[dom.ext]) role = `Mostly ${LANG_BY_EXT[dom.ext]}.`;
      else role = 'Supporting files.';
    }
    return { name: name || '(top level)', isRoot: !name, count: list.length, role, ext: dom?.ext || '' };
  });
  all.sort((a, b) => b.count - a.count);
  // Folding away one or two folders saves nothing, so only fold when it is worth it.
  if (all.length <= max + 2) return all;
  // Source folders can be small (header-only libraries) but must never be hidden.
  const keep = (d) => /^(src|source|lib|core|include|single_include|apps?|packages)$/i.test(d.name);
  const head = [...all.slice(0, max - 1), ...all.slice(max - 1).filter(keep)];
  const rest = all.filter((d) => !head.includes(d));
  if (!rest.length) return head;
  head.push({
    name: `${rest.length} more folders`, isRoot: false, isRest: true,
    count: rest.reduce((s, d) => s + d.count, 0), role: rest.slice(0, 4).map((d) => d.name).join(', ') + (rest.length > 4 ? ' and others.' : '.'), ext: '',
  });
  return head;
}

export function startHere(files, repoName = '') {
  const picks = [];
  const add = (path, why) => { if (path && !picks.some((p) => p.path === path)) picks.push({ path, why }); };
  add(files.find((f) => /^readme(\.[a-z]+)?$/i.test(f)), 'What the project is for, in the maintainers’ words.');
  add(files.find((f) => /^(\.github\/|docs?\/)?contributing(\.[a-z]+)?$/i.test(f)), 'The house rules for contributors. Read before you open a PR.');

  const name = repoName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const entries = files
    .filter((f) => !IGNORED_DIR.test(f) && !TEST_PATH.test(f) && !EXAMPLE_PATH.test(f) && !DOCS_PATH.test(f) && !/(^|\/)\./.test(f) && depthOf(f) <= 3)
    .map((f) => {
      const b = baseOf(f).toLowerCase();
      const stem = b.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/g, '');
      let score = 0;
      if (/^(main|index|app|cli|lib|mod|__init__|__main__)\.[a-z]+$/.test(b)) score = 3;
      if (name && stem === name && !DOCS_PATH.test(f)) score = Math.max(score, 4);
      if (/^(core|base)\.[a-z]+$/.test(b)) score = Math.max(score, 2);
      return { f, score: score ? score - depthOf(f) * 0.4 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const e of entries.slice(0, 3)) add(e.f, 'Looks like an entry point. A good place to start reading code.');
  return picks.slice(0, 5);
}

export function readiness(files) {
  const has = (re) => files.some((f) => re.test(f));
  return [
    { label: 'Contributing guide', ok: has(/^(\.github\/|docs?\/)?contributing(\.[a-z]+)?$/i),
      yes: 'There are written rules. Follow them and reviews go faster.', no: 'No guide. Mirror the style of recent merged PRs.' },
    { label: 'Automated checks', ok: has(/^\.github\/workflows\/.+\.ya?ml$/i) || has(/^(\.travis\.yml|\.circleci\/|azure-pipelines\.yml|\.gitlab-ci\.yml)/i),
      yes: 'CI runs on every PR, so you will know quickly if something breaks.', no: 'No CI found. Run the tests yourself before pushing.' },
    { label: 'Test suite', ok: files.some((f) => TEST_PATH.test(f)),
      yes: 'Tests exist. Add or update one alongside your fix.', no: 'No tests found. Explain in the PR how you checked your change.' },
    { label: 'Code of conduct', ok: has(/(^|\/)code_of_conduct(\.[a-z]+)?$/i),
      yes: 'The project has a code of conduct.', no: 'No code of conduct file.' },
    { label: 'Licence', ok: has(/^(licen[cs]e|copying)(\.[a-z]+)?$/i),
      yes: 'Open licence, so your contribution can be accepted.', no: 'No licence file. Check before investing time.' },
  ];
}

// ---------- getting it running ----------

export function detectStack(files, pkg = null) {
  const top = new Set(files.filter((f) => !f.includes('/')));
  const has = (re) => files.some((f) => re.test(f));
  const testDir = has(/^(tests?|spec)\//i);

  if (top.has('CMakeLists.txt')) return {
    name: 'CMake (C/C++)',
    build: ['cmake -S . -B build', 'cmake --build build -j'],
    test: ['ctest --test-dir build --output-on-failure'],
    note: 'You need a C++ compiler and CMake 3.x installed.',
  };
  if (top.has('meson.build')) return {
    name: 'Meson', build: ['meson setup build', 'meson compile -C build'], test: ['meson test -C build'],
    note: 'You need Meson and Ninja installed.',
  };
  if (top.has('MODULE.bazel') || top.has('WORKSPACE') || top.has('WORKSPACE.bazel')) return {
    name: 'Bazel', build: ['bazel build //...'], test: ['bazel test //...'], note: 'First builds are slow while Bazel fetches dependencies.',
  };
  if (top.has('Cargo.toml')) return { name: 'Cargo (Rust)', build: ['cargo build'], test: ['cargo test'], note: 'Install Rust with rustup if you have not.' };
  if (top.has('go.mod')) return { name: 'Go modules', build: ['go build ./...'], test: ['go test ./...'], note: '' };
  if (top.has('package.json')) {
    const pm = top.has('pnpm-lock.yaml') ? 'pnpm' : top.has('yarn.lock') ? 'yarn' : top.has('bun.lockb') || top.has('bun.lock') ? 'bun' : 'npm';
    const scripts = pkg?.scripts || {};
    const run = (s) => (pm === 'npm' ? `npm run ${s}` : `${pm} ${s}`);
    const build = [`${pm} install`];
    if (scripts.build) build.push(run('build'));
    const test = [];
    if (scripts.test && !/no test specified/.test(scripts.test)) test.push(pm === 'npm' ? 'npm test' : `${pm} test`);
    if (scripts.lint) test.push(run('lint'));
    return {
      name: `Node.js (${pm})`, build, test: test.length ? test : ['# no test script found; check package.json'],
      note: pkg ? '' : 'Could not read package.json, so these are best guesses.',
    };
  }
  if (top.has('pyproject.toml') || top.has('setup.py') || top.has('requirements.txt')) {
    const build = ['python -m venv .venv', 'source .venv/bin/activate'];
    if (top.has('pyproject.toml') || top.has('setup.py')) build.push('pip install -e .');
    if (top.has('requirements.txt')) build.push('pip install -r requirements.txt');
    const dev = files.find((f) => /^requirements[-_]dev\.txt$/i.test(f));
    if (dev) build.push(`pip install -r ${dev}`);
    return { name: 'Python', build, test: [testDir || has(/(^|\/)conftest\.py$/) ? 'pytest' : '# look for a tests folder or Makefile target'], note: 'On Windows, activate with .venv\\Scripts\\activate.' };
  }
  if (top.has('pom.xml')) return { name: 'Maven (Java)', build: ['mvn -q package -DskipTests'], test: ['mvn test'], note: '' };
  if (top.has('build.gradle') || top.has('build.gradle.kts')) return { name: 'Gradle', build: ['./gradlew build -x test'], test: ['./gradlew test'], note: '' };
  if (top.has('Makefile') || top.has('makefile')) return { name: 'Make', build: ['make'], test: ['make test'], note: 'Target names vary. Skim the Makefile first.' };
  return { name: 'Unknown', build: ['# no standard build file found'], test: [], note: 'The README should explain how to build it.' };
}

// ---------- issues ----------

export const GRADES = [
  { max: 2.0, key: 'easy', name: 'Easy walk' },
  { max: 2.9, key: 'moderate', name: 'Moderate' },
  { max: 3.8, key: 'steep', name: 'Steep' },
  { max: 9, key: 'scramble', name: 'Scramble' },
];
export const gradeFor = (d) => GRADES.find((g) => d <= g.max);

const LEVEL_TARGET = { first: 1.6, some: 2.5, comfortable: 3.4 };

export function rateIssue(issue, level = 'first', now = Date.now()) {
  const labels = labelNames(issue).map((l) => l.toLowerCase());
  const any = (re) => labels.some((l) => re.test(l));
  const body = stripNoise(issue.body || '');
  const notes = [];
  let d = 2.6;

  if (any(STARTER_LABEL)) d -= 1;
  if (any(/doc|typo|spelling|readme/)) d -= 0.6;
  if (any(/medium|moderate|intermediate/)) d += 0.8;
  if (any(/hard|difficult|complex|expert|advanced/)) d += 1.8;
  if (any(/feature|enhancement|proposal|design/)) d += 0.4;
  if (any(/performance|perf|security|concurrency|thread/)) d += 0.6;

  if (body.length > 2500) d += 0.8;
  else if (body.length > 900) d += 0.4;
  else if (body.length < 70) {
    d += 0.2;
    notes.push({ tone: 'warn', text: 'Short description. Ask in the thread what a good fix looks like before you start.' });
  }
  if (/```[\s\S]*?(error|exception|traceback|segfault|panic|assert|undefined reference)/i.test(issue.body || '')) d += 0.3;

  const assignees = issue.assignees?.length ? issue.assignees : issue.assignee ? [issue.assignee] : [];
  if (assignees.length) notes.push({ tone: 'warn', text: `Assigned to @${assignees[0].login}. Pick another unless they have gone quiet.` });

  const comments = issue.comments || 0;
  if (comments >= 10) notes.push({ tone: 'warn', text: `Busy thread with ${comments} comments. Someone may already be working on it.` });
  else if (comments === 0) notes.push({ tone: 'good', text: 'No comments yet. Nobody has claimed it in the thread.' });

  const ageDays = (now - Date.parse(issue.created_at)) / 864e5;
  const idleDays = (now - Date.parse(issue.updated_at || issue.created_at)) / 864e5;
  if (ageDays > 730) notes.push({ tone: 'warn', text: `Opened ${Math.floor(ageDays / 365)} years ago. Check it still applies.` });
  if (idleDays < 14) notes.push({ tone: 'good', text: 'Active in the last two weeks, so maintainers are around.' });

  const difficulty = clamp(Math.round(d * 10) / 10, 1, 5);
  let fit = 1 - Math.abs(difficulty - LEVEL_TARGET[level]) / 3;
  if (assignees.length) fit -= 0.5;
  if (comments >= 10) fit -= 0.15;
  if (ageDays > 730) fit -= 0.1;
  fit = clamp(fit, 0, 1);

  const verdict = fit >= 0.72 ? 'Good match for you' : fit >= 0.45 ? 'A stretch, but doable' : 'Probably one to save for later';
  return { difficulty, grade: gradeFor(difficulty), fit, verdict, notes, assigned: assignees.length > 0, labels: labelNames(issue) };
}

export function rankIssues(issues, level, now = Date.now()) {
  return issues
    .filter((i) => !i.pull_request)
    .map((issue) => ({ issue, rating: rateIssue(issue, level, now) }))
    .sort((a, b) => b.rating.fit - a.rating.fit || a.rating.difficulty - b.rating.difficulty);
}

// ---------- which files will I touch? ----------

function stripNoise(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
}

export function extractTerms(text, boost = 1) {
  const terms = new Map();
  const add = (raw, w, kind) => {
    const t = raw.toLowerCase().replace(/^\.\//, '').replace(/[.,:;)]+$/, '');
    if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t)) return;
    const cur = terms.get(t);
    if (!cur || cur.w < w * boost) terms.set(t, { w: w * boost, kind, shown: raw.replace(/[.,:;)]+$/, '') });
  };
  const src = stripNoise(text || '');

  for (const m of src.matchAll(/`([^`\n]{2,120})`/g)) {
    for (const tok of m[1].split(/[^A-Za-z0-9_./-]+/)) {
      if (!tok) continue;
      if (/\w\.[a-z]{1,5}$/i.test(tok) && /[a-z]/i.test(tok)) add(tok, 3, 'file');
      else add(tok.replace(/[./-]+$/, ''), 2.2, 'code');
    }
  }
  for (const m of src.matchAll(/\b([\w-]+(?:\/[\w.-]+)*\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ipp|inl|js|jsx|ts|tsx|mjs|py|rs|go|java|kt|rb|php|cs|swift|md|rst|json|ya?ml|toml|cmake|sh))\b/gi)) add(m[1], 3, 'file');
  for (const m of src.matchAll(/\b([A-Za-z_]\w*(?:::[A-Za-z_]\w*)+)\b/g)) for (const p of m[1].split('::')) add(p, 1.8, 'code');
  for (const m of src.matchAll(/\b([a-z]+(?:_[a-z0-9]+)+|[a-z]+(?:[A-Z][a-z0-9]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)) add(m[1], 1.8, 'code');
  for (const m of src.matchAll(/\b([A-Za-z]{4,})\b/g)) add(m[1], 0.7, 'word');
  return terms;
}

export function isDocsIssue(issue) {
  return labelNames(issue).some((l) => /doc|typo|spelling|readme/i.test(l)) || /\b(docs?|documentation|readme|typo|spelling)\b/i.test(issue.title || '');
}

export function likelyFiles(issue, files, limit = 5, repoName = '') {
  const terms = extractTerms(issue.body || '');
  for (const [t, v] of extractTerms(issue.title || '', 1.6)) {
    const cur = terms.get(t);
    if (!cur || cur.w < v.w) terms.set(t, v);
  }
  // The project's own name appears everywhere (fmt::, nlohmann::), so it tells us nothing.
  if (repoName) terms.delete(repoName.toLowerCase());
  if (!terms.size) return { files: [], tests: [] };

  const docsIssue = isDocsIssue(issue);
  const candidates = files.filter((f) => !IGNORED_DIR.test(f) && !NOT_CODE.test(f));

  const matchStrength = (lower, base, stem, segs, t) => {
    if (t.includes('/') || /\.[a-z]{1,5}$/.test(t)) {
      if (lower.endsWith(t)) return 6;
      if (base === t.slice(t.lastIndexOf('/') + 1)) return 4.5;
      return 0;
    }
    if (stem === t) return 4;
    if (t.length >= 4 && stem.includes(t)) return 2;
    if (segs.includes(t)) return 1.2;
    return 0;
  };

  const prepared = candidates.map((f) => {
    const lower = f.toLowerCase();
    const base = baseOf(lower);
    const stem = base.replace(/\.[^.]+$/, '');
    return { f, lower, base, stem, segs: lower.split('/').slice(0, -1) };
  });

  // How common is each term across the tree? Rare matches are worth more.
  const df = new Map();
  for (const t of terms.keys()) {
    let n = 0;
    for (const p of prepared) if (matchStrength(p.lower, p.base, p.stem, p.segs, t)) n++;
    df.set(t, n);
  }

  const scored = [];
  for (const p of prepared) {
    let score = 0;
    const hits = [];
    for (const [t, v] of terms) {
      const s = matchStrength(p.lower, p.base, p.stem, p.segs, t);
      if (!s) continue;
      score += (s * v.w) / Math.log2(2 + df.get(t));
      hits.push({ t: v.shown, s: s * v.w });
    }
    if (!score) continue;
    const isTest = TEST_PATH.test(p.f);
    if (!docsIssue && DOCS_PATH.test(p.f)) score *= 0.3;
    if (docsIssue && DOCS_PATH.test(p.f)) score *= 1.4;
    if (EXAMPLE_PATH.test(p.f)) score *= 0.6;
    scored.push({ path: p.f, score, isTest, hits: hits.sort((a, b) => b.s - a.s).map((h) => h.t) });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored.length ? scored[0].score : 0;
  const keep = (x) => x.score >= Math.max(1.1, top * 0.25);
  const main = scored.filter((x) => !x.isTest && keep(x)).slice(0, limit);

  // For each main file, look for a test that shares its name.
  const tests = [];
  for (const m of main.slice(0, 3)) {
    const stem = baseOf(m.path).replace(/\.[^.]+$/, '').toLowerCase().replace(/[-_]?(impl|inl)$/, '');
    if (stem.length < 4) continue;
    const t = candidates.find((f) => TEST_PATH.test(f) && baseOf(f).toLowerCase().includes(stem) && !tests.includes(f));
    if (t) tests.push(t);
  }
  for (const x of scored.filter((s) => s.isTest && keep(s))) if (tests.length < 3 && !tests.includes(x.path)) tests.push(x.path);

  return {
    files: main.map((x) => ({ path: x.path, why: x.hits.slice(0, 3) })),
    tests: tests.slice(0, 3),
  };
}

// ---------- the pull request ----------

export function branchFor(issue) {
  const prefix = isDocsIssue(issue) ? 'docs' : labelNames(issue).some((l) => /feature|enhancement/i.test(l)) ? 'feat' : 'fix';
  const words = (issue.title || '')
    .toLowerCase()
    .replace(/`/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 5);
  const slug = words.join('-').slice(0, 40).replace(/-+$/, '') || 'change';
  return `${prefix}/${issue.number}-${slug}`;
}

export function prDescription(issue, touched = []) {
  const lines = [
    `Fixes #${issue.number}`,
    '',
    '## What this changes',
    '<!-- One or two sentences in your own words. -->',
    '',
    '## How I tested it',
    '<!-- Commands you ran, and what you checked by hand. -->',
    '',
  ];
  if (touched.length) {
    lines.push('## Files touched', ...touched.map((f) => `- \`${f}\``), '');
  }
  lines.push('This is my first contribution here, so feedback on style or approach is very welcome.');
  return lines.join('\n');
}

export function languageShares(languages) {
  const entries = Object.entries(languages || {});
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  const sorted = entries.sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, share: n / total }));
  const main = sorted.filter((l) => l.share >= 0.02).slice(0, 5);
  const rest = 1 - main.reduce((s, l) => s + l.share, 0);
  if (rest > 0.005) main.push({ name: 'Other', share: rest });
  return main;
}
