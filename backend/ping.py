import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from time import perf_counter


# 192.0.2.0/24 = documentation/test network
IGNORED_SERVERS = {
    "192.0.2.1",
    "192.0.2.2",
}


def test_server(profile: dict, timeout: float = 3.0) -> dict:
    """
    Measure TCP connection latency to server:port.
    """

    server = profile["server"]
    port = profile["port"]

    # Ignore known dummy/test entries.
    if server in IGNORED_SERVERS:
        profile["latency"] = None
        profile["status"] = "ignored"
        return profile

    start = perf_counter()

    try:
        with socket.create_connection(
            (server, port),
            timeout=timeout,
        ):
            elapsed_ms = (
                perf_counter() - start
            ) * 1000

        profile["latency"] = round(elapsed_ms)
        profile["status"] = "online"

    except (OSError, TimeoutError) as exc:
        profile["latency"] = None
        profile["status"] = "offline"
        profile["error"] = str(exc)

    return profile


def test_servers(
    profiles: list[dict],
    max_workers: int = 20,
) -> list[dict]:
    """
    Test multiple servers concurrently.
    """

    # Remove dummy entries.
    profiles = [
        profile
        for profile in profiles
        if profile["server"] not in IGNORED_SERVERS
    ]

    if not profiles:
        return []

    results = []

    with ThreadPoolExecutor(
        max_workers=max_workers
    ) as executor:

        futures = [
            executor.submit(
                test_server,
                profile,
            )
            for profile in profiles
        ]

        for future in as_completed(futures):

            try:
                result = future.result()
                results.append(result)

            except Exception as exc:
                print(
                    "Ping error:",
                    exc,
                )

    # Online servers first.
    # Then lowest latency.
    results.sort(
        key=lambda profile: (
            profile.get("latency") is None,
            profile.get("latency") or 999999,
        )
    )

    return results