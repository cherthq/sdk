#!/usr/bin/env bash
# Offline exact-artifact gate. Never publishes; leaves the reviewed package and logs in the output directory.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
exclude=$(git rev-parse --git-path info/exclude)
grep -qxF '/.amp/in/' "$exclude" || printf '\n/.amp/in/\n' >> "$exclude"
mkdir -p "$root/.amp/in"
out=${1:?Usage: bash dotnet/verify-package.sh OUTPUT_DIRECTORY}
mkdir -p "$out"
out=$(realpath "$out")
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
version=$(dotnet msbuild "$root/dotnet/Chert.Sdk/Chert.Sdk.csproj" -getProperty:Version)
scratch=$(mktemp -d "$root/.amp/in/package-consumer.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
dotnet run --project "$root/dotnet/Tests" -c Release | tee "$out/source-tests.log"
dotnet pack "$root/dotnet/Chert.Sdk" -c Release -o "$out" | tee "$out/pack.log"
package="$out/chert-sdk.$version.nupkg"
unzip -Z1 "$package" | tee "$out/package-files.txt"
unzip -p "$package" chert-sdk.nuspec > "$out/chert-sdk.nuspec"
grep -q '<id>chert-sdk</id>' "$out/chert-sdk.nuspec"
grep -q '<license type="expression">MIT</license>' "$out/chert-sdk.nuspec"
if grep -q '<dependency ' "$out/chert-sdk.nuspec"; then echo 'Unexpected package dependency' >&2; exit 1; fi
if grep -Ev '^(_rels/\.rels|chert-sdk\.nuspec|lib/net8\.0/TryChert\.dll|LICENSE|README\.md|\[Content_Types\]\.xml|package/services/metadata/core-properties/[A-Za-z0-9]+\.psmdcp)$' "$out/package-files.txt"; then
    echo 'Unexpected package contents' >&2; exit 1
fi
mkdir -p "$scratch/feed" "$scratch/Tests" "$scratch/Examples"
cp "$package" "$scratch/feed/"
cp "$root/dotnet/NuGet.Config" "$scratch/NuGet.Config"
cp "$root/dotnet/Tests/"*.cs "$root/dotnet/Tests/Tests.csproj" "$scratch/Tests/"
cp "$root/dotnet/Examples/"*.cs "$root/dotnet/Examples/Examples.csproj" "$scratch/Examples/"
# Empty, task-owned package cache: no accidental resolution from a developer's installed package.
export NUGET_PACKAGES="$scratch/packages"
dotnet restore "$scratch/Tests" --source "$scratch/feed" -p:TestedPackageVersion="$version" | tee "$out/consumer-restore.log"
dotnet run --project "$scratch/Tests" --no-restore -c Release -p:TestedPackageVersion="$version" | tee "$out/consumer-tests.log"
dotnet restore "$scratch/Examples" --source "$scratch/feed" -p:TestedPackageVersion="$version" >> "$out/consumer-restore.log"
dotnet run --project "$scratch/Examples" --no-restore -c Release -p:TestedPackageVersion="$version" | tee "$out/example.log"
shasum -a 256 "$package" | tee "$out/SHA256SUMS"
echo 'Exact package content inspection and clean-consumer loopback checks passed. Publication remains a separate approval.'
