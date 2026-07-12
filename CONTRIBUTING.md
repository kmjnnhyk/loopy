# Contributing to loopy

Thanks for your interest in improving loopy! This guide covers everything you
need to propose a change.

loopy is **early, pre-1.0, and type-surface first** — the compile-time contract
(`tool` / `agent` / `workflow` / `team`, the registry, end-to-end inference) is
the product, so changes are weighed against type safety and inference quality,
not just runtime behavior. The public API may still shift before `1.0.0`.

By contributing, you agree that your contributions are licensed under the
project's [MIT license](./LICENSE) (inbound = outbound). No CLA to sign.

Please also read our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Before you start

- **Bug?** Open a [bug report](https://github.com/kmjnnhyk/loopy/issues/new?template=bug_report.yml)
  with a **minimal reproduction**.
- **New feature or API change?** Open a
  [feature request](https://github.com/kmjnnhyk/loopy/issues/new?template=feature_request.yml)
  **before** writing code. Large or API-shaping changes should be agreed on in an
  issue first — it avoids wasted work when the type surface can't accommodate the shape.
- **A usage question or open-ended idea?** Use
  [Discussions](https://github.com/kmjnnhyk/loopy/discussions), not an issue.
- **A security vulnerability?** Do **not** open a public issue — see
  [SECURITY.md](./SECURITY.md).

Good first contributions: docs fixes, new annotated `examples/`, and issues
labeled [`good first issue`](https://github.com/kmjnnhyk/loopy/labels/good%20first%20issue).

## Development setup

loopy is a [Bun](https://bun.sh) workspace monorepo. Bun is the primary runtime —
it runs the TypeScript source directly via each package's `bun` export condition.

```sh
git clone https://github.com/kmjnnhyk/loopy.git
cd loopy
bun install
```

The five published packages all live under `packages/`:

| Package | What it is |
|---|---|
| `@loopyjs/core` | The DSL + event-sourced runtime kernel |
| `@loopyjs/anthropic` | Anthropic model adapter |
| `@loopyjs/test` | Record→replay testing harness |
| `@loopyjs/cli` | `loopy` CLI (`loopy dev`, `loopy test`) |
| `@loopyjs/devtools` | Local observability web UI |

## The gate: `bun run check`

There is **one command** you must pass before opening a PR — it is exactly what
CI runs:

```sh
bun run check
```

It runs, in order:

1. `tsc --build` — type-checks and builds all five packages (maintainer gate:
   `src` only, `isolatedDeclarations` ON).
2. `tsc -p tsconfig.examples.json` — compiles the consumer-side `examples/`,
   emitting inferred `.d.ts` (this is how public inference is verified).
3. `bun run check:negative` — compiles `tsconfig.negative.json` and asserts it
   produces **exactly 8** expected type errors (the must-error fixtures in
   `examples/_negative.ts`). If you change the type surface, this count may need
   to move with a matching fixture change — see below.
4. `bun test` — the runtime + harness suite (event sourcing, drivers,
   human-in-the-loop, replay determinism).

DevTools or CLI changes additionally need the browser end-to-end suite:

```sh
cd packages/devtools
bunx playwright install --with-deps chromium   # once
bun run test:e2e
```

### Type-surface changes and the negative fixtures

`examples/_negative.ts` pins the diagnostics the type surface is *supposed* to
produce (a missing dependency, a stray router key, a non-member `passTo`, …).
`bun run check:negative` asserts the total is 8. If your change intentionally
adds or removes an error, update the fixture **and** the expected count in the
`check:negative` script together, and explain why in the PR.

## Tests

- **Runtime / behavior:** add or update tests near the code (`bun test`).
- **Type-level guarantees:** add a compile-assertion in `examples/` (things that
  *should* compile) or a fixture in `examples/_negative.ts` (things that
  *shouldn't*). Type behavior is a first-class contract here, not an afterthought.
- **Record→replay:** if you touch the runtime, make sure `@loopyjs/test` replays
  don't diverge. Effect arguments must stay deterministic given the run input.

## Opening a pull request

1. Fork the repo (or branch, if you have write access) off `master`.
2. Make your change and ensure `bun run check` passes.
3. Push and open a PR against `master`. Fill in the PR template.
4. **CI must be green** (`check` + `e2e`) before a PR can merge.
5. A maintainer reviews. PRs are **squash-merged**, so:
   - Your PR becomes **one commit** on `master`; individual WIP commits are
     collapsed — no need to keep a tidy commit history within the PR.
   - The **PR title becomes the commit message**, so write it as a
     [Conventional Commit](https://www.conventionalcommits.org/): `feat(team): …`,
     `fix(core): …`, `docs: …`, `chore: …`, `ci: …`. Add `!` (e.g. `feat(core)!: …`)
     for a breaking change.
6. Keep PRs focused — one logical change each. It makes review (and reverts) sane.

## Releasing

Releases are maintainer-only and automated from CI via npm Trusted Publishing.
See [RELEASING.md](./RELEASING.md) if you're curious how it works.

---

Questions about contributing? Open a
[discussion](https://github.com/kmjnnhyk/loopy/discussions). Thanks again! 🌀
