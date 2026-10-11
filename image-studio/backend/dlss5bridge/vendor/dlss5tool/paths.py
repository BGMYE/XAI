"""XAI adapter: keep vendored resources separate from user-owned DLSS runtimes.

Adapted from DLSS5Tool e23654c6 (MIT). Environment values are inherited by
Windows multiprocessing spawn workers, including PyInstaller children.
"""
import os
from pathlib import Path


def project_root():
    return Path(__file__).resolve().parents[1]


def app_root():
    return Path(os.environ.get('XAI_DLSS5_TOOL_ROOT', str(project_root())))


def resource_root():
    return project_root()


def runtime_root():
    return Path(os.environ.get('XAI_DLSS5_RUNTIME_ROOT', str(app_root() / 'runtime')))


def state_path(filename):
    directory = Path(os.environ.get('XAI_DLSS5_STATE_ROOT', str(app_root() / 'var')))
    directory.mkdir(parents=True, exist_ok=True)
    return directory / filename
