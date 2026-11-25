# npm 0.4.0 / Python 0.3.0 release preparation

Source integration, registry publication and service deployment are separate.
The original preparation published nothing: npm was 0.3.0 and PyPI was 0.2.3.
The separately authorized npm publication is recorded below; Python is still gated.

## npm publication receipt

On November 25, 2026, the existing [trusted-publishing workflow](https://github.com/cherthq/sdk/actions/runs/45552536256)
accepted npm 0.4.0 from [release v0.4.0](https://github.com/cherthq/sdk/releases/tag/v0.4.0),
source `f62e6e1bbaf2ff45ec6c415722073f5b69b0c4e1`. npm initially reported processing;
public registry metadata and clean installs were verified after it became visible.
The public archive is byte-identical to the tested candidate:
`c620b97d3c6a360aa70c9fcf899aa442e29ef008254f308b81dc3ad6b1d0c9d4` (SHA256).
Public-install Node/Bun participant consumers and Node/Bun/Deno distribution
checks pass. These are local HTTP contract tests, not physical invitation proof.
No trust settings changed. Python remains unpublished and blocked by #44.

## Version policy and scope

The repository has no enforced cross-language version alignment. The npm 0.3.0
release left Python source at 0.3.0 without publishing it. Continue independent
versions: npm 0.4.0 discloses the corrected TypeScript lookup contract; Python
0.3.0 includes all Python changes since published 0.2.3. Native preview versions
do not change. See the [changelog](../CHANGELOG.md) for consumer changes and limits.

The root npm version, migration CLI `SDK_VERSION` and packed-manifest assertion
must agree. Python's `pyproject.toml` and installed-wheel version assertion must
agree independently. Registry quickstarts now target verified npm 0.4.0; Python
registry examples remain at 0.2.3. Migration output targets npm 0.4.0.

## Verified artifacts

Build from the exact reviewed source revision, with a clean tracked tree. Use the
locked Bun dependencies and the Python build backend declared in `pyproject.toml`.
Retain `trychert-sdk-0.4.0.tgz`, `chert_sdk-0.3.0-py3-none-any.whl` and
`chert_sdk-0.3.0.tar.gz`, recording each SHA256 and its source commit separately.

Run typecheck, JavaScript unit and distribution checks, the packed-package test
with `CHERT_PACKAGE_ARCHIVE` pointing to the retained npm tarball, and the full
Python suite. Independently install the retained wheel and sdist into fresh
environments and run the public-resource and participant consumer tests with
isolated Python imports. Check installed metadata and import paths, not only
the source checkout. These contract tests use local fixtures; they do not prove
live service enablement or that an invited participant joined a call.

## Independent publication paths (separate approval required)

### npm

The existing [Publish npm workflow](../.github/workflows/publish-npm.yml) is
manual-dispatch only. It downloads the already-verified tarball from the GitHub
release `v0.4.0`, checks its supplied SHA256, package name and version, rejects an
already-published version, and uses npm trusted publishing through the existing
`npm` environment on a GitHub-hosted Node 24 runner. After approval, attach the
exact verified tarball to that release and dispatch with version `0.4.0` and its
recorded hash. Do not rebuild a replacement artifact during publication.

The original preparation created no tag, release or workflow dispatch. Each later
publication requires its own authorization and configured publisher identity.

### Python

There is no PyPI publishing workflow. [Issue #44](https://github.com/cherthq/sdk/issues/44)
tracks the required decision: configure a PyPI trusted publisher for `cherthq/sdk`,
`publish-pypi.yml` and protected `pypi` environment, then review the matching
exact-artifact workflow; or explicitly approve and document an alternative
publication path. Historical token-based `uv publish` is not current authorization
to reuse credentials. Do not add an unconfigured workflow or silently fall back
to a token. Publish only the verified wheel and sdist after separate approval.

### After either publication

Verify the registry version and file hashes, then install that registry version
into a fresh consumer. Update published-version documentation only after those
checks. npm and Python may be approved and published independently; neither
enables gated backend capabilities or releases the other language.
