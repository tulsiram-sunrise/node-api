# node-api documentation

Start with [PLAN.md](PLAN.md) for project status and what comes next. Read [CONVENTIONS.md](CONVENTIONS.md) before you change any code.

| Document | Read it when you need to |
| --- | --- |
| [PLAN.md](PLAN.md) | See phase status, the release checklist, the roadmap (Phases 5–10), risks and open decisions |
| [GAP_ANALYSIS.md](GAP_ANALYSIS.md) | See what is missing, basic (B1–B29) and advanced (A1–A32), with priority, effort, and an OWASP API Top 10 check |
| [RESTRUCTURE.md](RESTRUCTURE.md) | Understand why and how the code moves to feature modules under `src/` (Phase 7) |
| [STANDARDS.md](STANDARDS.md) | Understand the move to late-2026 standards: Node 26, ESM, TypeScript, Vitest, Zod, pino, OpenAPI, Problem Details (Phase 8) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Understand the folder layout, request lifecycle, data model and auth flow |
| [API.md](API.md) | Call the API: every endpoint, request/response examples, error codes |
| [CONVENTIONS.md](CONVENTIONS.md) | Write code that fits: naming, layering, errors, validation, tests, git |
| [BEST_PRACTICES.md](BEST_PRACTICES.md) | Make good engineering choices: Express 5, Mongoose 9, config, logging, dependencies |
| [SECURITY.md](SECURITY.md) | Understand the threat model, the security controls in place and the review checklist |
| [RELEASE.md](RELEASE.md) | Ship v2.0.0: migration scripts, rollout steps and rollback |
| [DECISIONS.md](DECISIONS.md) | Learn why things are the way they are (architecture decision records) |

The project memory for AI coding assistants is [../CLAUDE.md](../CLAUDE.md). It summarizes these documents and links back to them.

## Keeping docs current

- When code changes behaviour, update the matching doc in the same pull request.
- When you finish a plan item, tick it in [PLAN.md](PLAN.md) and record the date.
- When you make a significant decision, add an entry to [DECISIONS.md](DECISIONS.md). Never rewrite an accepted entry; supersede it with a new one.
