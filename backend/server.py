import time
import requests

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
import singbox

from ping import test_servers
from subscription import parse_subscription

USER_SUBSCRIPTION_URL = None

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================
# Global state
# ==============================

profiles: list[dict] = []


current_connection = {

    "connected": False,

    "index": None,

    "name": None,

    "server": None,

    "port": None,

    "latency": None,

    "started": None
}



class ConnectRequest(BaseModel):

    index: int

class SubscriptionRequest(BaseModel):

    url: str


# ==============================
# Status
# ==============================

@app.get("/api/status")
def status():

    try:

        running = singbox.is_running()

    except Exception:

        running = False


    current_connection["connected"] = running


    return {

        "connected":
            running,

        "running":
            running,

        "index":
            current_connection["index"],

        "server":
            current_connection["server"],

        "port":
            current_connection["port"],

        "latency":
            current_connection["latency"],

        "count":
            len(profiles)
    }


# ==============================
# Load profiles
# ==============================
@app.post("/api/subscription")
def set_subscription(
    request: SubscriptionRequest
):

    global USER_SUBSCRIPTION_URL


    USER_SUBSCRIPTION_URL = (
        request.url.strip()
        or None
    )


    return {
        "success": True
    }

@app.get("/api/profiles")


def get_profiles():

    global profiles

    print(
        "USING SUBSCRIPTION:",
        USER_SUBSCRIPTION_URL
    )


    try:

        subscription_url = (
            USER_SUBSCRIPTION_URL
            or config.SUBSCRIPTION_URL
        )


        response = requests.get(

            subscription_url,

            timeout=30,
            headers={

                "Accept": "*/*",

                "Cache-Control":
                    "no-cache",

                "User-Agent":
                    "Mozilla/5.0"

            }

        )


        response.raise_for_status()



        profiles = parse_subscription(

            response.text

        )


        if not profiles:

            raise HTTPException(

                status_code=422,

                detail="No profiles found"

            )



        profiles = test_servers(

            profiles

        )



        result = []


        for index, profile in enumerate(profiles):

            result.append({

                "index":
                    index,

                "name":
                    profile.get(
                        "name",
                        "VPN"
                    ),

                "scheme":
                    profile.get(
                        "scheme",
                        ""
                    ),

                "server":
                    profile.get(
                        "server",
                        ""
                    ),

                "port":
                    profile.get(
                        "port",
                        0
                    ),

                "latency":
                    profile.get(
                        "latency"
                    ),

                "status":
                    profile.get(
                        "status"
                    )

            })



        return {

            "count":
                len(result),

            "profiles":
                result

        }



    except requests.RequestException as exc:


        raise HTTPException(

            status_code=502,

            detail=str(exc)

        )



# ==============================
# Connect
# ==============================

@app.post("/api/connect")
def connect(

    request: ConnectRequest

):


    if not profiles:

        raise HTTPException(

            status_code=400,

            detail="Load profiles first"

        )



    if (

        request.index < 0

        or

        request.index >= len(profiles)

    ):

        raise HTTPException(

            status_code=400,

            detail="Invalid index"

        )



    selected = profiles[
        request.index
    ]



    try:


        singbox.stop()

        time.sleep(0.5)


        singbox.start(

            selected

        )



    except Exception as exc:


        raise HTTPException(

            status_code=500,

            detail=str(exc)

        )



    current_connection.update({

        "connected":
            True,

        "index":
            request.index,

        "name":
            selected.get(
                "name"
            ),

        "server":
            selected.get(
                "server"
            ),

        "port":
            selected.get(
                "port"
            ),

        "latency":
            selected.get(
                "latency"
            ),

        "started":
            time.time()

    })



    return {

        "status":
            "connected",

        "profile":

            {

                "name":
                    current_connection["name"],

                "server":
                    current_connection["server"],

                "port":
                    current_connection["port"],

                "latency":
                    current_connection["latency"]

            }

    }



# ==============================
# Disconnect
# ==============================

@app.post("/api/disconnect")
def disconnect():


    try:

        singbox.stop()


    except Exception:

        pass



    current_connection.update({

        "connected":
            False,

        "index":
            None,

        "name":
            None,

        "server":
            None,

        "port":
            None,

        "latency":
            None,

        "started":
            None

    })



    return {

        "status":
            "disconnected"

    }



# ==============================
# Auto reconnect
# ==============================

@app.post("/api/auto-reconnect")
def auto_reconnect():

    global profiles


    # اگر VPN هنوز فعال است
    if singbox.is_running():

        return {
            "connected": True,
            "message": "already running"
        }


    # اگر پروفایل نداریم، دانلود و parse کنیم
    if not profiles:

        try:

            response = requests.get(
                config.SUBSCRIPTION_URL,
                timeout=30,
                headers={
                    "Accept": "*/*",
                    "User-Agent":
                    "Mozilla/5.0"
                },
            )

            response.raise_for_status()

            profiles = parse_subscription(
                response.text
            )

            profiles = test_servers(
                profiles
            )


        except Exception as exc:

            raise HTTPException(
                status_code=500,
                detail=str(exc)
            )


    online = [
        p for p in profiles
        if p.get("status") == "online"
        and p.get("latency") is not None
    ]


    if not online:

        return {
            "connected": False,
            "message": "no available server"
        }


    # سریع‌ترین سرور
    best = min(
        online,
        key=lambda x:
        x.get("latency", 9999)
    )


    try:

        singbox.start(best)


    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


    return {

        "connected": True,

        "server":
            best.get("server"),

        "latency":
            best.get("latency")

    }
# ==============================

if __name__ == "__main__":

    import uvicorn


    uvicorn.run(

        app,

        host=config.API_HOST,

        port=config.API_PORT

    )