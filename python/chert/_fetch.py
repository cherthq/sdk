"""Fetch-backed opener for Pyodide runtimes such as Cloudflare Python Workers."""
from __future__ import annotations

import asyncio
import importlib
from http.client import HTTPMessage
from typing import Any


class FetchResponse:
    """Minimal urllib-style response over a JavaScript fetch Response."""

    def __init__(self, opener: FetchOpener, response: Any, controller: Any, timeout: float):
        self._opener = opener
        self._controller = controller
        self._timeout = timeout
        self.code = int(response.status)
        self.status = self.code
        self.headers = HTTPMessage()
        for name, value in response.headers.entries():
            self.headers[str(name)] = str(value)
        body = response.body
        self._reader = body.getReader() if body is not None else None
        self._buffer = bytearray()

    def _pull(self) -> bool:
        if self._reader is None:
            return False
        chunk = self._opener._run(self._reader.read(), self._controller, self._timeout)
        if chunk.done:
            self._reader = None
            return False
        if chunk.value is not None:
            self._buffer += chunk.value.to_bytes()
        return True

    def read(self, amount: int = -1) -> bytes:
        while (amount < 0 or len(self._buffer) < amount) and self._pull():
            pass
        size = len(self._buffer) if amount < 0 else min(amount, len(self._buffer))
        data = bytes(self._buffer[:size])
        del self._buffer[:size]
        return data

    def read1(self, amount: int = -1) -> bytes:
        while not self._buffer and self._pull():
            pass
        size = len(self._buffer) if amount < 0 else min(amount, len(self._buffer))
        data = bytes(self._buffer[:size])
        del self._buffer[:size]
        return data

    def close(self) -> None:
        reader, self._reader = self._reader, None
        self._buffer.clear()
        if reader is not None:
            try:
                self._opener._run(reader.cancel(), self._controller, self._timeout)
            except OSError:
                pass

    def __enter__(self) -> FetchResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class FetchOpener:
    """One fetch per request: manual redirects, no retries, per-read timeout."""

    def __init__(self) -> None:
        ffi = importlib.import_module("pyodide.ffi")
        self._js = importlib.import_module("js")
        self._run_sync = ffi.run_sync
        self._to_js = ffi.to_js
        self._js_error = ffi.JsException

    def _run(self, awaitable: Any, controller: Any, timeout: float) -> Any:
        async def bounded() -> Any:
            try:
                return await asyncio.wait_for(awaitable, timeout)
            except asyncio.TimeoutError:
                controller.abort()
                raise TimeoutError("fetch timed out") from None

        try:
            return self._run_sync(bounded())
        except self._js_error:
            raise OSError("fetch failed") from None

    def open(self, request: Any, *, timeout: float) -> FetchResponse:
        controller = self._js.AbortController.new()
        options: dict[str, Any] = {"method": request.get_method(), "headers": dict(request.header_items()),
                                   "redirect": "manual", "signal": controller.signal}
        if request.data is not None:
            options["body"] = bytes(request.data)
        init = self._to_js(options, dict_converter=self._js.Object.fromEntries)
        response = self._run(self._js.fetch(request.full_url, init), controller, timeout)
        try:
            return FetchResponse(self, response, controller, timeout)
        except self._js_error:
            raise OSError("fetch failed") from None
