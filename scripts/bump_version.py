#!/usr/bin/env python3
"""Bump the app version in the three places that must stay in sync.

    python scripts/bump_version.py 2.1.0

Updates package.json ("version"), backend/app/core/version.py (APP_VERSION) and prints
the git commands for tagging — the CI workflow only publishes a release for a v* tag,
and electron-updater compares the released version against package.json.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$")


def main() -> int:
    if len(sys.argv) != 2 or not SEMVER.match(sys.argv[1]):
        print(__doc__)
        return 1
    version = sys.argv[1]

    pkg_path = ROOT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    old = pkg.get("version")
    pkg["version"] = version
    pkg_path.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    ver_path = ROOT / "backend" / "app" / "core" / "version.py"
    text = ver_path.read_text(encoding="utf-8")
    new_text, n = re.subn(r'APP_VERSION = "[^"]*"', f'APP_VERSION = "{version}"', text)
    if n != 1:
        print(f"ERROR: could not find APP_VERSION in {ver_path}")
        return 1
    ver_path.write_text(new_text, encoding="utf-8")

    print(f"Version {old} -> {version}")
    print("Next:")
    print(f'  git commit -am "chore(release): v{version}"')
    print(f"  git tag v{version} && git push github main --tags")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
