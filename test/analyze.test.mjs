// Run with: node test/analyze.test.mjs
// Fixtures are real file trees from fmtlib/fmt and nlohmann/json.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as A from '../js/analyze.js';

const load = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim().split('\n');
const fmt = load('fmt-files.txt');
const json = load('json-files.txt');
const now = Date.parse('2026-10-03');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

test('parses every common way of writing a repo', () => {
  for (const s of ['fmtlib/fmt', 'https://github.com/fmtlib/fmt', 'github.com/fmtlib/fmt.git',
    'git@github.com:fmtlib/fmt.git', 'https://github.com/fmtlib/fmt/issues/12?x=1'])
    assert.deepEqual(A.parseRepoInput(s), { owner: 'fmtlib', repo: 'fmt' }, s);
  assert.equal(A.parseRepoInput('just words'), null);
});

test('detects CMake for fmt and pnpm scripts for a Node repo', () => {
  assert.equal(A.detectStack(fmt).name, 'CMake (C/C++)');
  const node = A.detectStack(['package.json', 'pnpm-lock.yaml'], { scripts: { build: 'tsc', test: 'vitest' } });
  assert.deepEqual(node.build, ['pnpm install', 'pnpm build']);
  assert.deepEqual(node.test, ['pnpm test']);
});

test('explains folders and finds the contributing guide', () => {
  const dirs = A.mapDirectories(fmt);
  assert.match(dirs.find((d) => d.name === 'include').role, /headers/);
  assert.ok(A.startHere(json, 'json').some((r) => r.path === '.github/CONTRIBUTING.md'));
});

test('points a chrono issue at chrono.h and its test', () => {
  const issue = { number: 1, title: 'Support formatting std::chrono::year_month_day',
    body: 'It would be nice if `fmt::format("{}", ymd)` worked. See chrono.h.', labels: [] };
  const m = A.likelyFiles(issue, fmt, 5, 'fmt');
  assert.equal(m.files[0].path, 'include/fmt/chrono.h');
  assert.ok(m.tests.includes('test/chrono-test.cc'));
});

test('points a docs typo at the docs, not the code', () => {
  const issue = { number: 2, title: 'Typo in docs/api.md', body: 'seperator should be separator', labels: [{ name: 'documentation' }] };
  assert.equal(A.likelyFiles(issue, fmt, 5, 'fmt').files[0].path, 'doc/api.md');
});

test('finds from_json in nlohmann/json', () => {
  const issue = { number: 3, title: 'from_json fails for std::optional', body: 'Using `NLOHMANN_DEFINE_TYPE_INTRUSIVE` throws `type_error`.', labels: [] };
  assert.equal(A.likelyFiles(issue, json, 5, 'json').files[0].path, 'include/nlohmann/detail/conversions/from_json.hpp');
});

test('ranks an easy unassigned issue above a hard assigned one for a beginner', () => {
  const easy = { number: 10, title: 'Fix typo', body: 'x'.repeat(200), labels: [{ name: 'good first issue' }], comments: 1, created_at: '2026-09-01', updated_at: '2026-09-30' };
  const hard = { number: 11, title: 'Locale races', body: 'x'.repeat(3000), labels: [{ name: 'help wanted' }], comments: 15, created_at: '2023-01-01', updated_at: '2025-01-01', assignees: [{ login: 'someone' }] };
  const ranked = A.rankIssues([hard, easy], 'first', now);
  assert.equal(ranked[0].issue.number, 10);
  assert.equal(ranked[0].rating.grade.key, 'easy');
  assert.ok(ranked[1].rating.notes.some((n) => /Assigned/.test(n.text)));
});

test('never folds source folders away', () => {
  const names = A.mapDirectories(json).map((d) => d.name);
  assert.ok(names.includes('single_include') && names.includes('include'));
  const many = Array.from({ length: 20 }, (_, i) => `big${i}/` + 'x'.repeat(i)).flatMap((p, i) => Array.from({ length: 30 - i }, (_, j) => `${p}${j}.c`));
  const dirs = A.mapDirectories([...many, 'src/a.c'], 10);
  assert.ok(dirs.some((d) => d.name === 'src'));
  assert.ok(dirs.some((d) => d.isRest));
});

test('makes readable branch names', () => {
  assert.equal(A.branchFor({ number: 42, title: 'Typo in README install section', labels: [{ name: 'docs' }] }), 'docs/42-typo-readme-install-section');
});

console.log(`\n${passed} passed`);
