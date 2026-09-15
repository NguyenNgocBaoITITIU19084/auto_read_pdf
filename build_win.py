"""Build the Windows desktop app: frontend bundle -> PyInstaller backend (backend_app.spec) -> electron-builder."""
import os
import subprocess

root = os.path.dirname(os.path.abspath(__file__))

subprocess.run("npm run build:frontend", cwd=root, shell=True, check=True)
subprocess.run(["pyinstaller", "backend_app.spec", "--noconfirm", "--clean"], cwd=root, check=True)
subprocess.run("npx electron-builder --win --x64", cwd=root, shell=True, check=True)
