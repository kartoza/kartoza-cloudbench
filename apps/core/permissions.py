"""What a connection's credentials may do, checked against what CloudBench needs.

Logging in isn't enough: a read-only S3 key, a GeoServer user who isn't an
administrator or a GeoNode user who may not add resources gets past a plain
connection test, then fails halfway through an upload. Each kind of
connection checks the permissions its features use (S3Client.check_permissions,
...), without leaving anything behind on the server, and a connection
missing one is refused, saying which and what it's needed for.
"""

from dataclasses import asdict, dataclass


@dataclass
class Permission:
    """One permission a connection needs, and whether its credentials have it."""

    name: str  # e.g. "write"
    needed_for: str  # what fails without it, e.g. "uploads and conversions"
    allowed: bool
    detail: str = ""  # why not, when the server says
    # Without it the connection is refused; else it's only reported, and the
    # feature needing it refuses when it's used.
    required: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


def missing(permissions: list[Permission]) -> list[Permission]:
    """The required permissions lacking: the ones a connection is refused for."""
    return [p for p in permissions if p.required and not p.allowed]


def refusal(what: str, permissions: list[Permission]) -> str:
    """Why a connection or an action is refused: which of `permissions` it lacks, and what for.

    e.g. "This key may not: write (needed for uploads and conversions);
    delete (needed for deleting files and replacing layers)."
    """
    lacking = "; ".join(
        f"{p.name} (needed for {p.needed_for})" for p in permissions if not p.allowed
    )
    return f"{what} may not: {lacking}."
