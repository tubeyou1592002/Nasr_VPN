import json
import subprocess
import time
import socket
from pathlib import Path

import requests

from config import (
    SUBSCRIPTION_URL,
    SING_BOX_PATH,
    LOCAL_HOST,
    LOCAL_PORT,
)

from subscription import parse_subscription


CONFIG_FILE = (
    Path(__file__).resolve().parent
    / "test-config.json"
)


def download_profiles():
    response = requests.get(
        SUBSCRIPTION_URL,
        timeout=30,
        headers={
            "Accept": "*/*",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": (
                "Mozilla/5.0 "
                "(Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/152.0.0.0 "
                "Safari/537.36"
            ),
        },
    )

    response.raise_for_status()

    return parse_subscription(
        response.text
    )


def make_vless_outbound(profile):
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
    }

    if profile.get("flow"):
        outbound["flow"] = profile["flow"]

    network = profile.get("network")

    if network == "ws":

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


def make_config(profile):

    outbound = make_vless_outbound(
        profile
    )

    return {
        "log": {
            "level": "info"
        },

        "inbounds": [
            {
                "type": "mixed",
                "tag": "mixed-in",

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
            "final": "proxy"
        }
    }


def wait_for_port(
    host,
    port,
    timeout=10,
):
    deadline = time.time() + timeout

    while time.time() < deadline:

        try:

            with socket.create_connection(
                (host, port),
                timeout=1,
            ):
                return True

        except OSError:
            time.sleep(0.2)

    return False


def main():

    print("Downloading subscription...")

    profiles = download_profiles()

    print(
        "Profiles:",
        len(profiles)
    )

    vless_profiles = [
        profile
        for profile in profiles
        if profile["scheme"] == "vless"
        and profile.get("uuid")
    ]

    if not vless_profiles:

        raise RuntimeError(
            "No usable VLESS profile found."
        )

    profile = vless_profiles[0]

    print()
    print("Selected profile:")
    print(
        profile["name"]
    )

    print(
        profile["server"],
        profile["port"]
    )

    config = make_config(
        profile
    )

    with open(
        CONFIG_FILE,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            config,
            file,
            ensure_ascii=False,
            indent=2,
        )

    print()
    print(
        "Config written to:"
    )

    print(CONFIG_FILE)

    print()
    print(
        "Checking config..."
    )

    result = subprocess.run(
        [
            str(SING_BOX_PATH),
            "check",
            "-c",
            str(CONFIG_FILE),
        ],
        capture_output=True,
        text=True,
    )

    print(
        result.stdout
    )

    if result.stderr:
        print(
            result.stderr
        )

    if result.returncode != 0:

        raise RuntimeError(
            "sing-box config check failed."
        )

    print(
        "Config OK."
    )

    print()
    print(
        "Starting sing-box..."
    )

    process = subprocess.Popen(
        [
            str(SING_BOX_PATH),
            "run",
            "-c",
            str(CONFIG_FILE),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:

        if wait_for_port(
            LOCAL_HOST,
            LOCAL_PORT,
            timeout=10,
        ):

            print()
            print(
                f"Local proxy is ready: "
                f"{LOCAL_HOST}:{LOCAL_PORT}"
            )

            print()
            print(
                "Press CTRL+C to stop."
            )

            for line in process.stdout:

                print(
                    line,
                    end=""
                )

        else:

            print(
                "Local proxy did not start."
            )

    except KeyboardInterrupt:

        print()
        print(
            "Stopping sing-box..."
        )

    finally:

        process.terminate()

        try:
            process.wait(
                timeout=5
            )
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    main()