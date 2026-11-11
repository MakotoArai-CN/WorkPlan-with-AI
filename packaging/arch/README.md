# Arch Linux Packages

The main Release workflow builds two x86_64 packages automatically:

- `workplan-bin-VERSION-1-x86_64.pkg.tar.zst`: installable with `sudo pacman -U`.
- `workplan-bin-VERSION-1.src.tar.gz`: the pinned PKGBUILD and `.SRCINFO` for rebuilding with `makepkg -si` as a normal user.

The package wraps the native Linux executable, **not** the Ubuntu AppImage. It uses the installed `webkit2gtk-4.1`, `gtk3`, `librsvg` and `libappindicator` libraries. CI installs the package inside an updated Arch Linux container, checks desktop/icon integration, runs `pacman -Qkk`, and rejects missing `ldd` dependencies. This is an install/linkage check, not a graphical desktop smoke test. Arch derivatives must provide compatible current runtime packages; only x86_64 is packaged.

## Release Flow

1. The Linux build creates `WorkPlan_VERSION_linux-x86_64.tar.gz` and its SHA-256 sidecar from the same binary used for DEB/RPM builds.
2. The reusable `arch-package.yml` consumes that same-run artifact. It does not depend on a release already being published.
3. `prepare-package.sh` verifies the archive checksum and pins `pkgver` / `sha256sums`. `makepkg` runs as an unprivileged user and verifies the payload again.
4. The release waits for package validation, then uploads both Arch packages, the portable archive, and a `SHA256SUMS` manifest covering all platforms.

## Rebuild a Published Version

Prefer the versioned `.src.tar.gz` from the release; the repository PKGBUILD retains the last checked-in binary pin and is a template updated by CI for each new release.

```bash
# Replace VERSION with the release you downloaded.
tar -xzf workplan-bin-VERSION-1.src.tar.gz
cd workplan-bin
makepkg -si
```

The manual Arch Package workflow can rebuild from a previously published portable archive. It uploads a CI artifact by default; attaching it to an existing release requires explicitly enabling `upload-to-release`. It will not create or publish an incomplete release.

## Installation

```bash
sudo pacman -U ./workplan-bin-VERSION-1-x86_64.pkg.tar.zst
sudo pacman -S --needed noto-fonts noto-fonts-cjk
```

Do not run `makepkg` as root. `pacman -U` installs the application, desktop launcher, icons and license; it resolves runtime dependencies through the configured package repositories. Checksums detect corruption but are not package signatures.
