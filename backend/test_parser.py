import requests

from subscription import parse_subscription
from config import SUBSCRIPTION_URL


def main():
    print("Downloading subscription...")
    print()
    print("URL:", SUBSCRIPTION_URL)
    print()

    headers = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": SUBSCRIPTION_URL.split("&b64")[0],
        "Sec-Ch-Ua": '"Chromium";v="152", "Not_A Brand";v="24", "Google Chrome";v="152"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/152.0.0.0 Safari/537.36"
        ),
    }

    try:
        response = requests.get(
            SUBSCRIPTION_URL,
            headers=headers,
            timeout=30,
        )

        print("HTTP status:", response.status_code)
        print(
            "Content-Type:",
            response.headers.get("content-type")
        )

        response.raise_for_status()

        content = response.text

        print(
            "Downloaded:",
            len(content),
            "characters"
        )

        print()
        print("First 100 characters:")
        print(content[:100])

        print()

        profiles = parse_subscription(content)

        print(
            "Profiles found:",
            len(profiles)
        )

        print()

        for index, profile in enumerate(profiles[:20]):
            print(
                f"{index:02d} | "
                f"{profile['scheme']:6} | "
                f"{profile['name'][:35]:35} | "
                f"{profile['server']}:{profile['port']}"
            )

    except requests.exceptions.RequestException as exc:
        print()
        print("REQUEST ERROR:")
        print(type(exc).__name__)
        print(exc)


if __name__ == "__main__":
    main()