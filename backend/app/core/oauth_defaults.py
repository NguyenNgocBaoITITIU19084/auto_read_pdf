"""Sign-in app ids shipped inside the build, so users only press "Đăng nhập" (no Client ID to paste).

CI writes them from GitHub Secrets into backend/app/core/oauth_builtin.py (scripts/write_oauth_builtin.py) right
before PyInstaller runs. That file is git-ignored: the ids never live in the source code. Without it (a dev checkout)
every value is "" and the settings screens ask for the ids as before.

Desktop sign-in apps are "public clients": Google says the secret of a Desktop-app OAuth client is not treated as
confidential, and the Microsoft app has no secret at all; PKCE protects every sign-in.
"""

KEYS = ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "OUTLOOK_CLIENT_ID", "OUTLOOK_TENANT_ID")


def builtin(key: str) -> str:
    try:
        from backend.app.core import oauth_builtin  # type: ignore[attr-defined]  # generated at build time
    except ImportError:
        return ""
    return str(getattr(oauth_builtin, key, "") or "").strip()
