from contextvars import ContextVar

# Holds the current request's lookup id so any code running within a request
# (services, background helpers) can tag its own log lines if needed.
# Default "-" is what shows up for log lines emitted outside a request (startup, scheduler).
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
