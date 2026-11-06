---
'@internal/release': patch
---

The `frontend-design` skill moved from `docs/SKILLS/frontend.md` to
`.claude/skills/frontend-design/SKILL.md`, which is the only place Claude Code
loads a skill from. `.claude/` is not gitignored here, so it is versioned with
the code rather than living on one machine.

`readme.test.ts` fails if a skill loses the `name` or `description` frontmatter
that makes it discoverable — a corrupted header disables a skill silently — or
if one reappears under `docs/`, where it would look installed and never load.
