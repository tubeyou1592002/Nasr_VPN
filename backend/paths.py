import os
import sys


def base_path():

    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)

    return os.path.dirname(
        os.path.abspath(__file__)
    )


BASE_DIR = base_path()


CONFIG_DIR = os.path.join(
    BASE_DIR,
    "config"
)


SINGBOX_PATH = os.path.join(
    BASE_DIR,
    "sing-box.exe"
)