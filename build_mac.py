import subprocess
subprocess.run(['pyinstaller', '--noconfirm', '--onedir', '--windowed', '--name', 'AutoReadPDF', 'src/main.py'], check=True)
