# -*- mode: python ; coding: utf-8 -*-


import os

from PyInstaller.utils.hooks import collect_data_files, copy_metadata

project_root = os.path.abspath('.')

# APScheduler 3.x resolves triggers/executors/jobstores via importlib.metadata entry
# points -> ship its dist-info metadata, otherwise add_job(trigger='cron') fails at runtime.
# tzdata provides the IANA database for zoneinfo('Asia/Ho_Chi_Minh') on Windows.
# (pyinstaller-hooks-contrib also ships hooks for both; this keeps the build correct without them.)
extra_datas = []
for _collect in (lambda: copy_metadata('APScheduler', recursive=True), lambda: collect_data_files('tzdata')):
    try:
        extra_datas += _collect()
    except Exception as _e:  # package missing -> warn instead of breaking the build
        print(f'WARNING: backend_app.spec data collection skipped: {_e}')

a = Analysis(
    ['backend/app/main.py'],
    pathex=[project_root],
    binaries=[],
    datas=extra_datas,
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'apscheduler',
        'apscheduler.schedulers',
        'apscheduler.schedulers.asyncio',
        'apscheduler.triggers',
        'apscheduler.triggers.interval',
        'apscheduler.triggers.cron',
        'apscheduler.triggers.date',
        'apscheduler.triggers.combining',
        'apscheduler.triggers.calendarinterval',
        'apscheduler.triggers.cron.expressions',
        'apscheduler.triggers.cron.fields',
        'apscheduler.executors',
        'apscheduler.executors.asyncio',
        'apscheduler.executors.pool',
        'apscheduler.jobstores',
        'apscheduler.jobstores.memory',
        'tzlocal',
        'tzdata',
        'zoneinfo',
        'backend',
        'backend.app',
        'backend.app.core',
        'backend.app.core.config',
        'backend.app.core.database',
        'backend.app.schemas',
        'backend.app.schemas.models',
        'backend.app.services',
        'backend.app.services.background_tasks',
        'backend.app.services.eport_client',
        'backend.app.services.exporter',
        'backend.app.services.extractor',
        'backend.app.services.image_extractor',
        'backend.app.api',
        'backend.app.api.bookings',
        'backend.app.api.collections',
        'backend.app.api.color_rules',
        'backend.app.api.containers',
        'backend.app.api.dashboard',
        'backend.app.api.export_backup',
        'backend.app.api.settings',
        'backend.app.api.vessels',
        'pdfplumber',
        'openpyxl',
        'pandas',
        'pydantic',
        'fastapi',
        'requests',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend_app',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='backend_app',
)
