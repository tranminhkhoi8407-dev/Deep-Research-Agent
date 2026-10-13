"""Session middleware with per-login persistence.

Starlette's built-in session middleware applies one ``Max-Age`` value to every
session. Successful logins are persistent by default; anonymous OAuth state
remains session-only. Users can disable persistence in their profile.
Session-only cookies also have a server-enforced deadline: browser session
restoration must not keep them valid indefinitely.
"""

from __future__ import annotations

import json
import time
from base64 import b64decode, b64encode

from itsdangerous.exc import BadSignature
from starlette.datastructures import MutableHeaders
from starlette.middleware.sessions import Session, SessionMiddleware
from starlette.requests import HTTPConnection
from starlette.types import Message, Receive, Scope, Send

SESSION_ONLY_SECONDS = 12 * 60 * 60
REMEMBERED_SECONDS = 30 * 24 * 60 * 60


class RememberSessionMiddleware(SessionMiddleware):
    """Apply the authenticated session's persistence and fixed expiry policy."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):  # pragma: no cover
            await self.app(scope, receive, send)
            return

        connection = HTTPConnection(scope)
        initial_session_was_empty = True

        if self.session_cookie in connection.cookies:
            data = connection.cookies[self.session_cookie].encode("utf-8")
            try:
                data = self.signer.unsign(data, max_age=self.max_age)
                payload = json.loads(b64decode(data, validate=True))
                if not isinstance(payload, dict):
                    raise ValueError("Invalid session")
                deadline = payload.get("expires_at")
                if deadline is not None and (type(deadline) is not int or deadline <= time.time()):
                    raise ValueError("Expired session")
                scope["session"] = Session(payload)
                initial_session_was_empty = False
            except (BadSignature, ValueError, TypeError, UnicodeError):
                scope["session"] = Session()
                scope["session"].clear()
                initial_session_was_empty = False
        else:
            scope["session"] = Session()

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                session: Session = scope["session"]
                headers = MutableHeaders(scope=message)
                if session.accessed:
                    headers.add_vary_header("Cookie")
                if session.modified and session:
                    data = b64encode(json.dumps(session).encode("utf-8"))
                    signed_data = self.signer.sign(data).decode("utf-8")
                    # Refreshing profile data must not slide the login deadline.
                    age = self.max_age
                    if type(session.get("expires_at")) is int:
                        age = max(0, min(age or REMEMBERED_SECONDS, session["expires_at"] - int(time.time())))
                    persistent_age = f"Max-Age={age}; " if session.get("remember") is True and age is not None else ""
                    headers.append(
                        "Set-Cookie",
                        (
                            f"{self.session_cookie}={signed_data}; path={self.path}; "
                            f"{persistent_age}{self.security_flags}"
                        ),
                    )
                elif session.modified and not initial_session_was_empty:
                    headers.append(
                        "Set-Cookie",
                        (
                            f"{self.session_cookie}=null; path={self.path}; "
                            "expires=Thu, 01 Jan 1970 00:00:00 GMT; "
                            f"{self.security_flags}"
                        ),
                    )
            await send(message)

        await self.app(scope, receive, send_wrapper)
