<!--
Thanks for contributing to loopy! A few things that make review fast:
- Keep the PR focused on one change.
- The PR title becomes the squashed commit on master — write it as a
  Conventional Commit (e.g. `fix(core): …`, `feat(team): …`, `docs: …`).
- Discuss large / API-changing work in an issue first.
-->

## Summary

<!-- What does this change and why? -->

## Related issue

<!-- e.g. "Closes #123". Required for bug fixes and features. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (type surface or runtime behavior changes)
- [ ] Docs / examples only
- [ ] Internal / chore (build, CI, refactor)

## Checklist

- [ ] `bun run check` passes locally (build + examples + negative fixtures + `bun test`).
- [ ] DevTools/CLI changes: `bun run test:e2e` passes in `packages/devtools` (if relevant).
- [ ] I added or updated tests covering the change (if applicable).
- [ ] I updated docs / examples (if behavior or the public API changed).
- [ ] The PR title is a Conventional Commit and describes the change accurately.
- [ ] I read [CONTRIBUTING.md](https://github.com/kmjnnhyk/loopy/blob/master/CONTRIBUTING.md) and agree my contribution is licensed under MIT.
