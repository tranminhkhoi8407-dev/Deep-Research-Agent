"""Small SMTP mailer for account recovery.

Messages contain only short-lived, single-use password-reset links. Credentials
come from environment variables and are never written to application logs.
"""

from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def password_reset_email_configured() -> bool:
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM_EMAIL", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    return bool(host and sender and ((not username and not password) or (username and password)))


def send_password_reset_email(recipient: str, reset_url: str) -> None:
    """Send a plain-text reset email using SSL or STARTTLS (never plaintext)."""
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM_EMAIL", "").strip()
    from_name = os.getenv("SMTP_FROM_NAME", "Nexora Agent").strip() or "Nexora Agent"
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    if not host or not sender or bool(username) != bool(password):
        raise ValueError("SMTP password-reset configuration is incomplete")

    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        timeout = max(3, min(int(os.getenv("SMTP_TIMEOUT_SECONDS", "15")), 60))
    except ValueError as exc:
        raise ValueError("SMTP port or timeout is invalid") from exc
    if not 1 <= port <= 65535:
        raise ValueError("SMTP port is invalid")

    message = EmailMessage()
    message["Subject"] = "Reset your Nexora Agent password"
    message["From"] = formataddr((from_name, sender))
    message["To"] = recipient
    message.set_content(
        "A password reset was requested for your Nexora Agent account.\n\n"
        f"Use this single-use link within 60 minutes:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this email."
    )

    context = ssl.create_default_context()
    if _truthy(os.getenv("SMTP_USE_SSL")):
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=context) as client:
            if username:
                client.login(username, password)
            client.send_message(message)
        return

    with smtplib.SMTP(host, port, timeout=timeout) as client:
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
        if username:
            client.login(username, password)
        client.send_message(message)
