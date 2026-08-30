---
name: interrogate
description: Run an adversarial review of a diff or selected files with independent subagents, then synthesize their findings. Use when the user asks to interrogate, challenge, stress-test, find blind spots in, or tear apart code changes.
license: MIT
compatibility: Requires access to the review artifact and an agent runtime that can launch independent subagents. Git is optional.
---

# Interrogate

Run independent adversarial reviews of code changes, then make a lead judgment over their findings. Give every reviewer the same prompt and rubric so agreement is meaningful.

Return a synthesized verdict. Leave the working tree unchanged.

## 1. Determine scope

Identify the review artifact from context:

1. Use files, a diff, or a fixed point named by the user.
2. Otherwise, if Git is available, determine the appropriate base branch or commit and review the complete changeset against it.
3. Gather the surrounding callers, callees, types, tests, and documentation needed to understand the changed code.
4. Keep the artifact bounded. Prefer file or diff paths when every reviewer can access them; inline content when they cannot.

Record the selected scope and comparison point for the final verdict.

## 2. State intent

Write one paragraph describing what the change is trying to accomplish. Derive it from:

- The user's request
- Commit messages and pull request metadata when available
- The code and tests

Reviewers judge whether the implementation achieves this intent. If the intent remains materially ambiguous after reading the available evidence, ask the user before dispatching reviewers.

## 3. Prepare the review

Read these files relative to this skill directory:

- `references/reviewer-prompt.md`
- `references/rubric.md`
- `references/code-quality-review.md`
- `references/lead-judgment.md`

Fill every placeholder in `reviewer-prompt.md` with:

1. The stated intent
2. The review artifact
3. The contents of `references/rubric.md`
4. The contents of `references/code-quality-review.md`

Use the same filled prompt for every reviewer.

## 4. Run reviewers

Use the agent runtime's native subagent mechanism.

Resolve the reviewer panel in this order:

1. Preferences in the user's current request
2. Reviewer configuration supplied by the project or agent runtime
3. Three independent read-only reviewers

Run the reviewers concurrently when supported. Give each reviewer the same intent, artifact, rubric, and code-quality lens. Keep reviewers independent: they return findings to the lead agent rather than discussing findings with one another.

If an explicitly requested reviewer or model is unavailable, report it. Use an alternative only when the runtime provides a clear equivalent. If the runtime cannot launch independent subagents, stop and report that this skill requires native subagent support.

Wait for every reviewer to finish. Record each reviewer as completed, failed, timed out, or partial. Count consensus only across completed independent reviews.

## 5. Synthesize findings

Build one findings set:

1. Parse each completed review by severity, location, evidence, and suggestion.
2. Merge findings that describe the same underlying issue.
3. Mark findings raised independently by two or more reviewers as consensus.
4. Preserve credible lone-reviewer findings with lower confidence.
5. Record explicit disagreements and reviewer failures.

Then apply `references/lead-judgment.md`. Categorize every finding as:

- **Act On**: a real correctness, security, or maintainability issue that should block the change
- **Consider**: a legitimate concern whose benefit may not outweigh its cost now
- **Noted**: valid context with little immediate value
- **Dismissed**: incorrect, unsupported, nitpicky, or missing material context

The lead agent owns these decisions. Reviewer severity and vote count are evidence, not the verdict.

## Output

### Intent
> [The stated intent]

### Scope
[Review artifact and comparison point]

### Reviewers
- Reviewer [label]: [model or agent name when available], [status], [finding count]

### Act On
[Finding, location, reviewers, evidence, and rationale]

### Consider
[Finding, location, reviewers, and tradeoff]

### Noted
[Brief list]

### Dismissed
[Rejected findings with a short rationale]

### Agreement Map
[Consensus, lone findings, disagreements, failures, and what the pattern means]
