#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
export GOWORK=off
# Keep the selected toolchain when the consumer gets an empty module cache.
export PATH="$(go env GOROOT)/bin:$PATH"
export GOTOOLCHAIN=local
cd "$root/go"
test -z "$(gofmt -l .)"
go vet ./...
go test -count=1 -timeout=60s ./...
go test -race -count=1 -timeout=60s ./...
go list -m all
go mod verify
go mod tidy -diff
go build ./...

# Copy only the module payload, then import it from an unrelated module without
# repository workspaces, cached third-party dependencies, or network access.
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir "$scratch/sdk" "$scratch/consumer" "$scratch/cache"
cp ./*.go go.mod LICENSE README.md CONTRACTS.md "$scratch/sdk/"
cp testdata/consumer/* "$scratch/consumer/"
test -s "$scratch/sdk/LICENSE"
export GOPROXY=off GOSUMDB=off GOMODCACHE="$scratch/cache"
cd "$scratch/consumer"
go mod edit -replace "github.com/cherthq/sdk/go=$scratch/sdk"
go mod tidy
go test -race -count=1 -timeout=60s ./...
go vet ./...
test "$(go list -m -f '{{.Path}}' github.com/cherthq/sdk/go)" = github.com/cherthq/sdk/go
printf 'Go module, contract/loopback, race, vet, format and clean-consumer checks passed.\n'
