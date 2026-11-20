# Fixed, native-owned program executed by pkexec. Arguments are data, never
# evaluated as shell source. Keep the user's verified Downloads copy intact.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077
source=$1
size=$2
digest=$3
manager=$4
case "$manager" in
    /usr/bin/apt-get|/usr/bin/dpkg) suffix=deb ;;
    /usr/bin/dnf|/usr/bin/rpm) suffix=rpm ;;
    /usr/bin/pacman) suffix=pkg.tar.zst ;;
    *) exit 64 ;;
esac
directory=$(/usr/bin/mktemp -d /tmp/workplan-update.XXXXXXXXXX)
package=$directory/package.$suffix
cleanup() {
    /usr/bin/rm -f -- "$package"
    /usr/bin/rmdir -- "$directory"
}
trap cleanup EXIT HUP INT TERM
# Refuse symlinks and bound the read even if the source becomes a device or
# FIFO during authorization. Staging is private until size AND SHA-256 match.
limit=$((size + 1))
# Count complete blocks even when a mounted/network filesystem returns short
# reads; without fullblock, dd can stop early on a valid package.
/usr/bin/dd if="$source" of="$package" bs=65536 count="$limit" iflag=fullblock,count_bytes,nofollow,nonblock status=none
[ "$(/usr/bin/wc -c < "$package")" -eq "$size" ] || exit 65
printf '%s  %s\n' "$digest" "$package" | /usr/bin/sha256sum --check --status - || exit 65
# apt's _apt sandbox may read the now-verified public release package; only
# root retains write permission to both the directory and its contents.
/usr/bin/chmod 755 "$directory"
/usr/bin/chmod 644 "$package"
case "$manager" in
    /usr/bin/apt-get) "$manager" --assume-yes install -- "$package" ;;
    /usr/bin/dpkg) "$manager" -i -- "$package" ;;
    /usr/bin/dnf) "$manager" --assumeyes install -- "$package" ;;
    /usr/bin/rpm) "$manager" -U -- "$package" ;;
    /usr/bin/pacman) "$manager" --noconfirm -U -- "$package" ;;
esac
