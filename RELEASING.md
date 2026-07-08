# Releasing

loopy publishes all 5 packages (`@loopyjs/{core,anthropic,test,cli,devtools}`)
in lockstep from CI, using **npm Trusted Publishing** (OIDC — no long-lived
token, automatic [provenance](https://docs.npmjs.com/generating-provenance-statements/)).

## One-time setup (maintainer, on npmjs.com)

Trusted Publishing needs a per-package trust relationship between npm and this
repo's `release.yml` workflow. Do this **once per package** (all 5):

1. npmjs.com → the package (e.g. `@loopyjs/core`) → **Settings** → **Trusted Publisher**.
2. Choose **GitHub Actions** and fill in:
   - Organization / user: `kmjnnhyk`
   - Repository: `loopy`
   - Workflow filename: `release.yml`
   - Environment: leave blank (the workflow uses none)
3. Save. Repeat for `@loopyjs/anthropic`, `@loopyjs/test`, `@loopyjs/cli`, `@loopyjs/devtools`.

Requirements the workflow already satisfies: `id-token: write` permission,
Node ≥ 22.14 + npm ≥ 11.5.1, and each package.json carries `repository.url` +
`repository.directory` (npm matches the trusted publisher against these).

Until a package's trusted publisher is configured, its `npm publish` step 403s.
The manual `bun publish` + granular-token path used for the first 0.1.0 release
still works as a fallback (see the monorepo memory / git history).

## Cutting a release

Versions are **lockstep** — all 5 packages share one version.

1. Bump the `version` field to the new version (e.g. `0.1.1`) in all 5
   `packages/*/package.json`. Keep them identical.
2. Commit on `master` (via PR): `chore(release): 0.1.1`.
3. Tag and push:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
   The `Release` workflow builds, rewrites `workspace:` → `^0.1.1`, and publishes
   all 5 under the `next` dist-tag with provenance.
4. To publish under a different dist-tag (e.g. `latest` for a stable release),
   run the workflow manually: **Actions → Release → Run workflow** and set the
   `tag` input.

## How the workflow handles `workspace:`

`npm` does not understand the `workspace:` protocol (it's a Bun/pnpm/yarn
feature). The workflow **builds first** (Bun resolves `workspace:` from the
local workspace), then runs `scripts/prepare-publish.mjs` to rewrite every
`workspace:^` to `^<version>` in the ephemeral checkout, then `npm publish
--ignore-scripts` uploads the pre-built tarballs. Consumers get normal
`^0.1.x` ranges; the rewrite is never committed.
