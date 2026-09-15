"""Placeholder HTML page served at GET / on the mobile LAN app.

Task 5 replaces the body of ``render_page`` with the real capture page
(camera access, upload JS, status polling). Kept as a single function so
that later task only needs to touch this file, not ``app.py``.
"""

from __future__ import annotations


def render_page() -> str:
    """Return the HTML document served at GET /."""
    return (
        "<!doctype html>"
        "<html lang=\"vi\">"
        "<head>"
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Auto Read PDF - Mobile</title>"
        "</head>"
        "<body>"
        "<p>Trang chup anh dang duoc chuan bi.</p>"
        "</body>"
        "</html>"
    )
