#!/usr/bin/env bash
set -euo pipefail

version="${1:?Expected release version}"
assets="$(realpath "${2:?Expected directory containing portable archive}")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid version' >&2; exit 1; }
archive="WorkPlan_${version}_linux-x86_64.tar.gz"
test -f "$assets/$archive"
test -f "$assets/$archive.sha256"
expected="$(awk 'NR==1 {print $1}' "$assets/$archive.sha256")"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Invalid checksum' >&2; exit 1; }
actual="$(sha256sum "$assets/$archive" | cut -d' ' -f1)"
[[ "${expected,,}" == "$actual" ]] || { echo 'Portable archive checksum mismatch' >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")"
sed -i "s/^pkgver=.*/pkgver=${version}/" PKGBUILD
sed -i "s/^sha256sums=.*/sha256sums=('${actual}')/" PKGBUILD
# makepkg verifies this exact same-run payload before the release exists.
cp "$assets/$archive" "workplan-bin-${version}.tar.gz"
