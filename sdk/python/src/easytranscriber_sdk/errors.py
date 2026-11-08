"""HTTP failures are distinct from transport errors raised by HTTPX."""


class APIError(Exception):
    """A non-success HTTP response, with the API's code and message when available."""

    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message
        super().__init__(f"HTTP {status} ({code}): {message}")


class APIResponseError(Exception):
    """A successful response was not a JSON object; it is never retried."""

    def __init__(self, status: int) -> None:
        self.status = status
        super().__init__(f"HTTP {status}: expected a JSON object response")
