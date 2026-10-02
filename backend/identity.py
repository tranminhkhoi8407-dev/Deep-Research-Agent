"""Shared validation for the user-chosen Nexora profile name."""

import re
import unicodedata


PUBLIC_NAME_PATTERN = re.compile(r"^[\w](?:[\w -]{1,28}[\w])?$", re.UNICODE)


def public_name_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().split()).casefold()


def validate_public_name(value: str) -> tuple[str, str]:
    name = " ".join(unicodedata.normalize("NFKC", value).strip().split())
    if not 3 <= len(name) <= 30 or not PUBLIC_NAME_PATTERN.fullmatch(name):
        raise ValueError("Use 3–30 letters, numbers, spaces, hyphens or underscores; no @ symbol")
    return name, public_name_key(name)
