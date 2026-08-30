## Commit

Before every commit, `pnpm test` and `pnpm build` both pass. Vitest excludes the renderer, so tests passing is not compile.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for hhubb22/picaglass, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
