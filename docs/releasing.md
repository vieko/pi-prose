# Releasing `pi-prose`

Releases are **tag-driven and automated**: pushing a `vX.Y.Z` tag triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which runs
the gate, publishes to npm via **OIDC trusted publishing** (no token, no OTP,
with provenance), and cuts the GitHub release.

## One-time setup (npmjs.com)

The package must exist on the registry first (v0.1.0 was published manually).
Then configure the trusted publisher once, on the package:

- npmjs.com → **pi-prose** → Settings → **Trusted Publisher** → GitHub Actions
- Organization or user: `vieko` · Repository: `pi-prose` · Workflow filename:
  `release.yml` · Environment: *(leave blank)*

This is what lets the workflow publish without a stored token or a 2FA prompt.

## Cut a release

1. **Bump the version**, commit, and push `main`:

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   npm run check        # be green locally first
   git commit -am "chore: vX.Y.Z" && git push
   ```

2. **Tag the release commit and push the tag** -- that is the whole trigger:

   ```bash
   git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z
   ```

   The tag version must equal `package.json`'s (the workflow enforces this).
   Watch it land: `gh run watch`.

## Installing a fresh release locally

If npm's `min-release-age` cooldown is configured, a just-published version is
uninstallable for its duration. Bypass for a trusted install of your own
release:

```bash
NPM_CONFIG_MIN_RELEASE_AGE=0 pi update --extensions
```

## Manual fallback

If trusted publishing is unavailable: `npm publish` from a clean checkout of
the tag, with the gate green (`npm ci && npm run check`).
