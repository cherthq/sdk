#!/usr/bin/env bash
# Local-only artifact gate. Never publishes, deploys, or contacts a Chert service.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
manifest="$root/rust/Cargo.toml"
out="${1:?usage: bash scripts/verify-rust-package.sh ABSOLUTE_ARTIFACT_DIRECTORY}"
case "$out" in /*) ;; *) echo 'artifact directory must be absolute' >&2; exit 2;; esac
mkdir -p "$out"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/chert-rust-review.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
cargo fmt --manifest-path "$manifest" --check
cargo test --offline --locked --manifest-path "$manifest" --all-targets
cargo test --offline --locked --manifest-path "$manifest" --doc
cargo clippy --offline --locked --manifest-path "$manifest" --all-targets -- -D warnings
cargo clippy --offline --locked --manifest-path "$manifest" --lib --no-default-features --features worker -- -D warnings
RUSTDOCFLAGS='-D warnings' cargo doc --offline --locked --no-deps --manifest-path "$manifest"
CARGO_TARGET_DIR="$scratch/build" cargo package --offline --locked --allow-dirty --manifest-path "$manifest"
archive="$scratch/build/package/chert-sdk-0.1.0.crate"
tar -tzf "$archive" | sort > "$out/package-files.txt"
# Inspect the exact tarball: reject unexpected members and path dependencies; compare source bytes.
python3 - "$archive" "$root/rust" <<'PY'
import hashlib, pathlib, sys, tarfile, tomllib
archive, source = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with tarfile.open(archive) as tar:
    members = tar.getmembers()
    names = {m.name for m in members}
    assert len(names) == len(members), 'duplicate archive members'
    expected = {p.relative_to(source).as_posix() for folder in ['src','tests','examples'] for p in (source/folder).rglob('*') if p.is_file()}
    expected |= {'Cargo.toml','Cargo.toml.orig','Cargo.lock','README.md','LICENSE','.cargo_vcs_info.json'}
    actual = set()
    for m in members:
        path = pathlib.PurePosixPath(m.name)
        assert m.isfile() and path.parts[0] == 'chert-sdk-0.1.0' and '..' not in path.parts
        relative = '/'.join(path.parts[1:])
        actual.add(relative)
        assert relative in expected, f'unexpected package member: {relative}'
        if relative not in {'Cargo.toml','.cargo_vcs_info.json'}:
            original = source / ('Cargo.toml' if relative == 'Cargo.toml.orig' else relative)
            assert tar.extractfile(m).read() == original.read_bytes(), f'archive differs: {relative}'
    assert actual == expected, f'missing files: {expected-actual}'
    manifest = tomllib.loads(tar.extractfile('chert-sdk-0.1.0/Cargo.toml').read().decode())
    assert manifest['package']['name'] == 'chert-sdk'
    assert manifest['lib']['name'] == 'trychert_sdk', 'preview import compatibility'
    assert manifest['package']['publish'] == [] or manifest['package']['publish'] is False
    assert manifest['package']['license'] == 'MIT'
    for section in ['dependencies','dev-dependencies']:
        for dep in manifest.get(section,{}).values():
            assert not isinstance(dep,dict) or not ({'path','git'} & dep.keys()), 'non-registry dependency'
print('Exact archive content and unpublished manifest verified')
print('sha256', hashlib.sha256(archive.read_bytes()).hexdigest())
PY
tar -xzf "$archive" -C "$scratch"
unpacked="$scratch/chert-sdk-0.1.0"
CARGO_TARGET_DIR="$scratch/build" cargo test --offline --locked --manifest-path "$unpacked/Cargo.toml" --all-targets
CARGO_TARGET_DIR="$scratch/build" cargo test --offline --locked --manifest-path "$unpacked/Cargo.toml" --doc
mkdir -p "$scratch/consumer/tests"
cat > "$scratch/consumer/Cargo.toml" <<'TOML'
[package]
name = "clean-chert-consumer"
version = "0.0.0"
edition = "2021"
[dependencies]
chert-sdk = { path = "../chert-sdk-0.1.0" }
serde_json = "=1.0.145"
tokio = { version = "=1.48.0", features = ["macros", "rt", "time"] }
TOML
# All public integration tests compile and execute with only declared consumer dependencies.
cp "$unpacked"/tests/*.rs "$scratch/consumer/tests/"
cp "$unpacked/Cargo.lock" "$scratch/consumer/Cargo.lock"
CARGO_TARGET_DIR="$scratch/build" cargo test --offline --manifest-path "$scratch/consumer/Cargo.toml"
cp "$archive" "$out/chert-sdk-0.1.0.crate"
shasum -a 256 "$out/chert-sdk-0.1.0.crate" > "$out/SHA256SUMS"
echo 'PASS: source, exact packaged crate, and clean consumer; nothing published'
