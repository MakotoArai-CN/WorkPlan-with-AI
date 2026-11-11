#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
version="$(tr -d '[:space:]' < VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid VERSION' >&2; exit 1; }
target_dir="${CARGO_TARGET_DIR:-src-tauri/target}"
output_dir="${1:-portable-assets}"
root="$output_dir/WorkPlan-linux-x86_64"
test -f "$target_dir/release/workplan"
mkdir -p "$root"
install -m755 "$target_dir/release/workplan" "$root/workplan"
install -m644 packaging/workplan.desktop "$root/workplan.desktop"
install -m644 LICENSE "$root/LICENSE"
for size in 32x32 64x64 128x128; do
    install -Dm644 "src-tauri/icons/$size.png" "$root/icons/$size/workplan.png"
done
install -Dm644 src-tauri/icons/128x128@2x.png "$root/icons/256x256/workplan.png"
archive="WorkPlan_${version}_linux-x86_64.tar.gz"
tar -C "$output_dir" -czf "$output_dir/$archive" WorkPlan-linux-x86_64
(cd "$output_dir" && sha256sum "$archive" > "$archive.sha256")
