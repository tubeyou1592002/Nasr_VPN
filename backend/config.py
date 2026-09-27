from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

SUBSCRIPTION_URL = (
    "https://shahrivar.tubeyou1592002.workers.dev/"
    "sub?token=2d3ed0967215006b3755a90fa786315a&b64"
)

LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = 2080

API_HOST = "127.0.0.1"
API_PORT = 8765

SING_BOX_PATH = (
    PROJECT_ROOT
    / "sing-box"
    / "sing-box.exe"
)

TEST_URL = (
    "https://www.gstatic.com/generate_204"
)