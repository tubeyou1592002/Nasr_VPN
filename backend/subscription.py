import base64
import json
import re
from urllib.parse import parse_qs, unquote, urlparse


SUPPORTED_SCHEMES = (
    "vless://",
    "vmess://",
    "trojan://",
    "ss://",
)


def clean_base64(text: str) -> str:
    """
    Remove whitespace and add required Base64 padding.
    """
    text = "".join(text.split())

    missing = (-len(text)) % 4

    if missing:
        text += "=" * missing

    return text


def try_b64(text: str) -> str | None:
    """
    Try standard and URL-safe Base64.
    """
    text = clean_base64(text)

    try:
        raw = base64.b64decode(
            text,
            validate=False,
        )

        return raw.decode(
            "utf-8",
            errors="replace",
        )

    except Exception:
        pass

    try:
        raw = base64.urlsafe_b64decode(text)

        return raw.decode(
            "utf-8",
            errors="replace",
        )

    except Exception:
        return None


def looks_like_profiles(text: str) -> bool:
    """
    Check whether text contains actual VPN URL schemes.
    """
    lower = text.lower()

    return any(
        scheme in lower
        for scheme in SUPPORTED_SCHEMES
    )


def decode_subscription(content: str) -> str:
    """
    Try multiple decoding layers.

    This handles:
    - plain text
    - Base64
    - double Base64
    """

    current = content.strip()

    # Plain text
    if looks_like_profiles(current):
        return current

    # First Base64 layer
    decoded = try_b64(current)

    if decoded:

        if looks_like_profiles(decoded):
            return decoded

        # Second Base64 layer
        decoded2 = try_b64(decoded)

        if decoded2 and looks_like_profiles(decoded2):
            return decoded2

    return current


def get_name(parsed) -> str:

    if parsed.fragment:
        return unquote(
            parsed.fragment
        )

    return f"{parsed.scheme.upper()} server"


def parse_vless(line: str) -> dict | None:

    try:

        line = line.strip()

        if not line.startswith(
            "vless://"
        ):
            return None


        parsed = urlparse(
            line
        )
        try:

            server = parsed.hostname

        except ValueError as exc:

            print(
                "Invalid VLESS host:",
                exc,
                line[:120]
            )

            return None


        if not server:
            return None
        port = parsed.port or 443

        query = parse_qs(
            parsed.query
        )

        def get(key: str) -> str:
            values = query.get(key)

            if values:
                return unquote(values[0])

            return ""

        return {
            "scheme": "vless",
            "name": get_name(parsed),

            "server": server,
            "port": port,

            "uuid": unquote(
                parsed.username or ""
            ),

            "security": get("security"),
            "network": get("type") or "tcp",

            "host": get("host"),
            "path": get("path"),
            "sni": get("sni"),

            "fingerprint": get("fp"),
            "flow": get("flow"),

            "encryption": get(
                "encryption"
            ),

            "url": line,
        }

    except Exception as exc:

        print(
            "VLESS parse error:",
            exc
        )

        return None


def parse_vmess(line: str) -> dict | None:

    try:

        encoded = line[len("vmess://"):]

        decoded = try_b64(encoded)

        if not decoded:
            return None

        data = json.loads(decoded)

        server = data.get("add")

        if not server:
            return None

        return {
            "scheme": "vmess",

            "name": (
                data.get("ps")
                or server
            ),

            "server": server,

            "port": int(
                data.get("port", 443)
            ),

            "uuid": data.get("id", ""),

            "security": data.get(
                "tls", ""
            ),

            "network": data.get(
                "net",
                "tcp"
            ),

            "host": data.get(
                "host",
                ""
            ),

            "path": data.get(
                "path",
                ""
            ),

            "sni": data.get(
                "sni",
                ""
            ),

            "raw": data,

            "url": line,
        }

    except Exception as exc:

        print(
            "VMess parse error:",
            exc
        )

        return None


def parse_trojan(line: str) -> dict | None:

    try:

        parsed = urlparse(line)

        server = parsed.hostname

        if not server:
            return None

        port = parsed.port or 443

        query = parse_qs(
            parsed.query
        )

        def get(key: str) -> str:

            values = query.get(key)

            if values:
                return unquote(
                    values[0]
                )

            return ""

        return {
            "scheme": "trojan",
            "name": get_name(parsed),

            "server": server,
            "port": port,

            "password": unquote(
                parsed.username or ""
            ),

            "security": get("security"),
            "network": get("type") or "tcp",

            "host": get("host"),
            "path": get("path"),
            "sni": get("sni"),

            "fingerprint": get("fp"),

            "url": line,
        }

    except Exception as exc:

        print(
            "Trojan parse error:",
            exc
        )

        return None


def parse_ss(line: str) -> dict | None:

    try:

        parsed = urlparse(line)

        server = parsed.hostname

        if not server:
            return None

        return {
            "scheme": "ss",

            "name": get_name(parsed),

            "server": server,

            "port": parsed.port or 443,

            "username": unquote(
                parsed.username or ""
            ),

            "password": unquote(
                parsed.password or ""
            ),

            "url": line,
        }

    except Exception as exc:

        print(
            "SS parse error:",
            exc
        )

        return None


def parse_line(line: str) -> dict | None:

    line = line.strip()

    if not line:
        return None

    lower = line.lower()

    if lower.startswith("vless://"):
        return parse_vless(line)

    if lower.startswith("vmess://"):
        return parse_vmess(line)

    if lower.startswith("trojan://"):
        return parse_trojan(line)

    if lower.startswith("ss://"):
        return parse_ss(line)

    return None


def extract_profile_lines(text: str) -> list[str]:
    """
    Extract individual VPN URLs embedded anywhere
    inside HTML / JavaScript / JSON / plain text.
    """

    # HTML escaping
    text = (
        text
        .replace("\\/", "/")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )

    import re

    pattern = re.compile(
        r'''(?:vless|vmess|trojan|ss)://[^\s\\'"<>`]+''',
        re.IGNORECASE
    )

    matches = pattern.findall(text)

    unique = []
    seen = set()

    for item in matches:

        item = item.strip()

        if item and item not in seen:

            seen.add(item)
            unique.append(item)

    return unique

def parse_subscription(
    content: str
) -> list[dict]:

    decoded = decode_subscription(content)

    print(
        "Decoded subscription length:",
        len(decoded)
    )

    print(
        "Contains profiles:",
        looks_like_profiles(decoded)
    )

    lines = extract_profile_lines(
        decoded
    )

    print(
        "Profile URLs found:",
        len(lines)
    )

    profiles = []

    for line in lines:

        print(
            "TRY PROFILE:",
            line[:150]
        )

        profile = parse_line(line)
        if profile:
            profiles.append(profile)

    print(
        "Successfully parsed:",
        len(profiles)
    )

    return profiles