"""Session middleware with per-login persistence.

Starlette's built-in session middleware applies one ``Max-Age`` value to every
session.  The web app needs a real "keep me signed in" choice, so this variant
only writes a persistent cookie when the signed session contains
``remember=True``.  Otherwise the browser receives a session cookie that is
removed when the browser session ends.
"""

from __future__ import annotations

import json
from base64 import b64decode, b64encode

from itsdangerous.exc import BadSignature
from starlette.datastructures import MutableHeaders
from starlette.middleware.sessions import Session, SessionMiddleware
from starlette.requests import HTTPConnection
from starlette.types import Message, Receive, Scope, Send


class RememberSessionMiddleware(SessionMiddleware):
    """Persist the signed session cookie only after explicit user opt-in."""

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
                scope["session"] = Session(json.loads(b64decode(data)))
                initial_session_was_empty = False
            except BadSignature:
                scope["session"] = Session()
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
                    persistent_age = (
                        f"Max-Age={self.max_age}; "
                        if session.get("remember") is True and self.max_age
                        else ""
                    )
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
