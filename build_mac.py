"""Build the macOS desktop app: frontend bundle -> PyInstaller backend (backend_app.spec) -> electron-builder."""
import os
import subprocess

root = os.path.dirname(os.path.abspath(__file__))
env = {**os.environ, "PYINSTALLER_CONFIG_DIR": os.path.join(root, ".pyinstaller_cache")}

subprocess.run(["npm", "run", "build:frontend"], cwd=root, check=True)
subprocess.run(["pyinstaller", "backend_app.spec", "--noconfirm", "--clean"], cwd=root, env=env, check=True)
subprocess.run(["npx", "electron-builder", "--mac"], cwd=root, check=True)
