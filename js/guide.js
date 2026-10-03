// guide.js
// The optional AI layer. Everything above works without it; this adds a
// plain-language walkthrough of one issue and a review of your diff.
// With no API key, the same prompt can be copied into any AI chat.

export const MODEL = 'claude-sonnet-5-5';

const SYSTEM = `You are a patient senior maintainer helping someone make their first contribution to an open-source project.
Be concrete: name files, functions and commands. Never invent file contents you have not been shown; say when you are guessing.
Write in short sections with plain Markdown (##, -, \`code\`, fenced blocks). Keep it under 400 words.`;

const trim = (s, n) => (s && s.length > n ? `${s.slice(0, n)}\n…(trimmed)` : s || '');

export function walkthroughPrompt(ctx, issue, matches, snippets) {
  return `Repository: ${ctx.owner}/${ctx.repo} (${ctx.meta.description || 'no description'})
Main languages: ${Object.keys(ctx.languages).slice(0, 4).join(', ')}
Build system: ${ctx.stack.name}

Issue #${issue.number}: ${issue.title}
Labels: ${(issue.labels || []).map((l) => l.name || l).join(', ') || 'none'}
---
${trim(issue.body, 4000)}
---

Files that look related (found by matching names in the issue against the file tree):
${matches.files.map((f) => `- ${f.path}`).join('\n') || '- none found'}
${matches.tests.length ? `Related tests:\n${matches.tests.map((t) => `- ${t}`).join('\n')}` : ''}

${snippets.map((s) => `Contents of ${s.path}:\n\`\`\`\n${trim(s.text, 6000)}\n\`\`\``).join('\n\n')}

Help me fix this as a first-time contributor. Give me:
## What the issue is asking
In two or three plain sentences.
## Where the change goes
The file(s) and the part of the code, with what to look for.
## A step-by-step plan
Small steps I can check off.
## How to test it
Including a test I could add.
## Ask before you start
One or two questions worth posting in the issue thread, if anything is unclear.`;
}

export function reviewPrompt(ctx, issue, diff) {
  return `I am about to open my first pull request to ${ctx.owner}/${ctx.repo} for issue #${issue.number}: "${issue.title}".

Issue description:
---
${trim(issue.body, 2500)}
---

My diff:
\`\`\`diff
${trim(diff, 12000)}
\`\`\`

Review it like a kind but careful maintainer would. Give me:
## Does it solve the issue?
## Problems to fix before submitting
Bugs, missed cases, style that does not match the surrounding code. Say "none" if there are none.
## Tests
Is the change tested? What test would a maintainer expect?
## Ready to submit?
Yes or not yet, in one line.`;
}

export async function askClaude(apiKey, prompt) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch {
    throw new Error('Could not reach the Anthropic API. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('The API key was rejected. Check it in Keys.');
  if (!res.ok) throw new Error(data?.error?.message || `The API answered with an error (${res.status}).`);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export function fullPrompt(prompt) {
  return `${SYSTEM}\n\n${prompt}`;
}

// A deliberately small Markdown renderer: escape first, then add structure.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

export function renderMarkdown(md) {
  const out = [];
  const lines = md.replace(/\r/g, '').split('\n');
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out.push(`<h4>${inline(h[2])}</h4>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}
