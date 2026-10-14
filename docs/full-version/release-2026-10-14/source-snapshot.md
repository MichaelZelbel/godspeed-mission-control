# Source snapshot for the corrected notebook label

The notebook runtime is pinned to `02f4ecbdd89276783004e102d032178f952f1c6e`: public product `9ab230680e2972eb424eeb54cbb83d1a8cc5ee9b` plus the three UI wording corrections. The bootstrap is `68f6103809e5b61b0c163b7797e7f4f65664aef3`, based on the previous `0eafb061d28a077b2d7c0cc83d0bd002fcb44444` with optional starter pinning. Both installers select starter commit `02f4ecbdd89276783004e102d032178f952f1c6e`, matching the installed runtime; the tools channel retains its previous behavior. User-edited existing recipes are preserved.

This source publication snapshot adds the corrected installer scripts, the tested Windows executable and its manifest, the download links, and these packaging notes. No newer runtime features from main are included. Running the installer supplied in this source archive installs the corrected notebook runtime.

The embedded `installers/SHA256SUMS` checks the three supplied installer files: Windows setup, shell installer and Windows manifest. The release's separate `SHA256SUMS` file also checks `Godspeed-v2-integrated-source.tar.gz`. The archive cannot embed its own checksum without a circular dependency.
