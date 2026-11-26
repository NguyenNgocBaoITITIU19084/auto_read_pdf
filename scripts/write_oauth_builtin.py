"""Write backend/app/core/oauth_builtin.py from environment variables (CI: GitHub Secrets) before PyInstaller.

    GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... OUTLOOK_CLIENT_ID=... [OUTLOOK_TENANT_ID=...] \
        python scripts/write_oauth_builtin.py

Missing variables are written as "" (that sign-in then asks for its ids in the app's settings, as before).
The generated file is git-ignored; never commit it.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.app.core.oauth_defaults import KEYS  # noqa: E402

TARGET = ROOT / "backend" / "app" / "core" / "oauth_builtin.py"
SAFE = re.compile(r"^[A-Za-z0-9._\-]*$")


def main() -> int:
    values = {k: os.environ.get(k, "").strip() for k in KEYS}
    bad = [k for k, v in values.items() if not SAFE.match(v)]
    if bad:
        print(f"Invalid characters in: {', '.join(bad)}", file=sys.stderr)
        return 1
    lines = ['"""Generated at build time by scripts/write_oauth_builtin.py. Do not commit."""', ""]
    lines += [f"{k} = {v!r}" for k, v in values.items()]
    TARGET.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for k, v in values.items():
        print(f"{k}: {'set' if v else 'empty'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
