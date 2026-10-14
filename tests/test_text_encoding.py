"""
Text files are read as UTF-8 explicitly: without `encoding=`, Python uses the system code page, which is
cp1252 on the Windows CI runner, and fixtures holding Vietnamese text ('KHÁCH HÀNG') fail to decode there.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# read_text() / write_text(x) / open(path) / open(path, "r"|"w"|"a") without an encoding
_NO_ENCODING = re.compile(r"\.read_text\(\s*\)|\.write_text\([^,()]*\)|\bopen\([^,()]+\)|\bopen\([^()]*,\s*['\"][rwa]t?['\"]\s*\)")


def test_text_files_are_read_and_written_as_utf8():
    offenders = []
    for folder in ("tests", "backend"):
        for path in (ROOT / folder).rglob("*.py"):
            if ".venv" in path.parts or path.name == Path(__file__).name:
                continue
            for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if _NO_ENCODING.search(line) and "encoding=" not in line and not re.search(r"\.open\(|_open\(", line):
                    offenders.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()}")
    assert offenders == []
