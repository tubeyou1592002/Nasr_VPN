import json
import socket
import subprocess
import time
from pathlib import Path

from config import (
    LOCAL_HOST,
    LOCAL_PORT,
    SING_BOX_PATH,
)


PROCESS: subprocess.Popen | None = None

CONFIG_FILE = (
    Path(__file__).resolve().parent
    / "active-config.json"
)


def build_vless_outbound(profile: dict) -> dict:
    tls = {
        "enabled": True,
    }

    if profile.get("sni"):
        tls["server_name"] = profile["sni"]

    if profile.get("fingerprint"):
        tls["utls"] = {
            "enabled": True,
            "fingerprint": profile["fingerprint"],
        }

    outbound = {
        "type": "vless",
        "tag": "proxy",

        "server": profile["server"],
        "server_port": profile["port"],
        "uuid": profile["uuid"],

        "tls": tls,
        "multiplex": {
            "enabled": False
        },

    }

    if profile.get("flow"):
        outbound["flow"] = profile["flow"]

    if profile.get("network") == "ws":

        transport = {
            "type": "ws",
        }

        if profile.get("path"):
            transport["path"] = profile["path"]

        if profile.get("host"):
            transport["headers"] = {
                "Host": profile["host"]
            }

        outbound["transport"] = transport

    return outbound


def build_config(profile: dict) -> dict:

    if profile["scheme"] != "vless":
        raise ValueError(
            "Currently only VLESS is supported."
        )

    outbound = build_vless_outbound(
        profile
    )

    return {
        "log": {
            "level": "debug"
        },

        "inbounds": [
            {
                "type": "mixed",
                "tag": "local",

                "listen": LOCAL_HOST,
                "listen_port": LOCAL_PORT,
            }
        ],

        "outbounds": [
            outbound,

            {
                "type": "direct",
                "tag": "direct"
            }
        ],

        "route": {
            "rules": [
                {
                    "inbound": [
                        "local"
                    ],
                    "outbound": "proxy"
                }
            ],
            "final": "proxy"
        }
    }


def write_config(profile: dict) -> Path:

    config = build_config(profile)

    with open(
        CONFIG_FILE,
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            config,
            file,
            ensure_ascii=False,
            indent=2,
        )

    return CONFIG_FILE


def stop() -> None:

    global PROCESS

    if PROCESS is None:
        return

    if PROCESS.poll() is None:

        PROCESS.terminate()

        try:
            PROCESS.wait(
                timeout=5
            )

        except subprocess.TimeoutExpired:
            PROCESS.kill()

    PROCESS = None


def wait_for_proxy(timeout: int = 10) -> bool:

    deadline = time.time() + timeout

    while time.time() < deadline:

        try:

            with socket.create_connection(
                (
                    LOCAL_HOST,
                    LOCAL_PORT
                ),
                timeout=1,
            ):
                return True

        except OSError:

            time.sleep(0.2)

    return False


def start(profile: dict) -> None:

    global PROCESS

    stop()

    config_path = write_config(
        profile
    )

    # Validate configuration first.
    check = subprocess.run(
        [
            str(SING_BOX_PATH),
            "check",
            "-c",
            str(config_path),
        ],
        capture_output=True,
        text=True,
    )

    if check.returncode != 0:

        raise RuntimeError(
            check.stderr
            or check.stdout
            or "Invalid sing-box configuration"
        )

    PROCESS = subprocess.Popen(
        [
            str(SING_BOX_PATH),
            "run",
            "-c",
            str(config_path),
        ],

    )

    if not wait_for_proxy(10):

        stop()

        raise RuntimeError(
            "sing-box started but local proxy "
            "did not become ready."
        )


def is_running():

    global PROCESS

    if PROCESS is None:
        return False

    return PROCESS.poll() is None