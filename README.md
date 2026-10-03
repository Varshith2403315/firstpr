# FirstPR

**Paste a GitHub repository. FirstPR maps it, finds an issue you can actually finish, and walks you to your first pull request.**

Live demo: `https://varshith2403315.github.io/firstpr/` · Try it on a real repo: `https://varshith2403315.github.io/firstpr/?repo=fmtlib/fmt`

---

## Why

Making a first open-source contribution is mostly not about code. It is about finding your way:
which of 1,000 files matter, which "good first issue" is really good for *you*, how to build the thing, and
what a maintainer expects in a pull request. Most people give up somewhere in that maze, before they write a line.

FirstPR treats a first contribution like a hiking trail. You get a map, a route graded by difficulty, and markers
at every stop until you reach the end: a pull request you are proud to open.

## What it does today

The route has five stops:

1. **Read the map.** Language breakdown, every top-level folder explained in plain words and sized by file count,
   the files to read first (readme, contributing guide, likely entry points), and a newcomer-readiness check
   (CI, tests, contributing guide, licence).
2. **Pick an issue.** Pulls open issues the maintainers labelled for newcomers (it finds whatever label the repo uses:
   `good first issue`, `beginner`, `easy`, `help wanted`…). Each one is graded like a trail (*Easy walk*, *Moderate*,
   *Steep*, *Scramble*) and ranked against your own experience level. It flags assigned issues, crowded threads and stale ones.
3. **Get it running.** Detects the build system (CMake, Meson, Bazel, Cargo, Go, npm/pnpm/yarn, Python, Maven, Gradle, Make)
   and writes the exact fork, clone, build and test commands, with your username filled in.
4. **Make the change.** Matches names in the issue against the whole file tree to point at the files you will
   probably touch and the tests that go with them, and suggests a branch name.
5. **Open the pull request.** Commit and push commands, a PR description that links the issue, and a one-click link
   to GitHub's compare page.

Two optional AI steps sit on top: **Walk me through it** reads the issue plus the matching source files and explains
the fix step by step, and **Review my diff** checks your change the way a maintainer would before you submit.
With no API key, both can copy their prompt for use in any AI chat, so nothing is locked.

## How the file matching works

No AI needed for this part. `js/analyze.js`:

- pulls candidate terms from the issue: backticked code, file names, `C++::scopes`, `snake_case` and `camelCase` identifiers,
  then plain words, with title terms weighted higher
- scores every path in the tree against those terms (exact file match > file stem > partial stem > folder name)
- divides by how many files each term matches, so rare names count more than common ones (an IDF-style weight)
- down-weights docs, examples and vendored code unless the issue is about docs, and drops the project's own name
- then looks for test files that share a name with the top matches

On fmtlib/fmt, an issue about `std::chrono::year_month_day` resolves to `include/fmt/chrono.h` and `test/chrono-test.cc`.

## Running it

It is plain HTML, CSS and JavaScript modules. No build step, no dependencies, no server.

```bash
git clone https://github.com/Varshith2403315/firstpr.git
cd firstpr
python3 -m http.server 8000     # any static server works
# open http://localhost:8000
```

Run the heuristics tests with Node 18+:

```bash
node test/analyze.test.mjs
```

GitHub allows 60 unauthenticated API requests an hour per network, and mapping one repo costs about six.
Add a GitHub token under **Keys** to raise that to 5,000. Keys stay in the browser tab and go only to GitHub and Anthropic.

## Layout

```
index.html          the page
styles.css          the visual identity (topographic map, trail blazes, difficulty grades)
js/app.js           UI and state
js/analyze.js       pure heuristics: repo map, stack detection, issue grading, file matching
js/github.js        GitHub REST client and repo loader
js/guide.js         optional AI walkthrough and diff review
js/topo.js          draws the contour lines behind the headline
test/               Node tests for analyze.js, with real file trees as fixtures
```

## Roadmap for Hackyard Build 2026

The prototype runs entirely in the browser. At the 24-hour build, FirstPR becomes a real agent:

- **Agent on Agent37.** Move the walkthrough and review into a persistent agent that remembers your progress across sessions,
  reads more of the codebase on its own, and checks out the repo to actually run the build and tests.
- **Smarter matching.** Use symbol search (functions and classes, not just file names) and recent commit history, so it can say
  "the last three fixes like this touched these lines".
- **Follow-through.** Watch the pull request after it is opened and explain maintainer review comments in plain words.

## Credits

Built solo by Siva Sai Varshith Mitta (@Varshith2403315) for Hackyard Build 2026. MIT licensed.
