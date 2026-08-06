"""PostgreSQL service configuration parser.

Parses pg_service.conf files to extract connection information.
"""

import os
import re
from pathlib import Path

from apps.core.models import PGService


def get_pg_service_file_paths() -> list[Path]:
    """Get possible pg_service.conf file locations.

    Returns paths in order of precedence:
    1. PGSERVICEFILE environment variable
    2. ~/.pg_service.conf
    3. /etc/pg_service.conf (system-wide)

    Returns:
        List of paths to check
    """
    paths = []

    # Check PGSERVICEFILE environment variable
    service_file = os.environ.get("PGSERVICEFILE")
    if service_file:
        paths.append(Path(service_file))

    # User's home directory
    home = Path.home()
    paths.append(home / ".pg_service.conf")

    # Also check PGSYSCONFDIR
    sys_conf_dir = os.environ.get("PGSYSCONFDIR", "/etc/postgresql-common")
    paths.append(Path(sys_conf_dir) / "pg_service.conf")

    # System-wide fallback
    paths.append(Path("/etc/pg_service.conf"))

    return paths


def find_pg_service_file() -> Path | None:
    """Find the first existing pg_service.conf file.

    Returns:
        Path to service file or None if not found
    """
    for path in get_pg_service_file_paths():
        if path.exists():
            return path
    return None


def parse_pg_service_file(path: Path | None = None) -> dict[str, PGService]:
    """Parse a pg_service.conf file.

    Args:
        path: Path to service file (auto-detect if None)

    Returns:
        Dictionary mapping service names to PGService objects
    """
    if path is None:
        path = find_pg_service_file()

    if path is None or not path.exists():
        return {}

    services: dict[str, PGService] = {}
    current_service: str | None = None
    current_params: dict[str, str] = {}

    # Section header pattern [service_name]
    section_pattern = re.compile(r"^\[([^\]]+)\]")
    # Key=value pattern
    param_pattern = re.compile(r"^(\w+)\s*=\s*(.*)$")

    with open(path) as f:
        for line in f:
            line = line.strip()

            # Skip empty lines and comments
            if not line or line.startswith("#") or line.startswith(";"):
                continue

            # Check for section header
            section_match = section_pattern.match(line)
            if section_match:
                # Save previous service if exists
                if current_service and current_params:
                    services[current_service] = _params_to_service(
                        current_service, current_params
                    )

                current_service = section_match.group(1)
                current_params = {}
                continue

            # Check for parameter
            param_match = param_pattern.match(line)
            if param_match and current_service:
                key = param_match.group(1).lower()
                value = param_match.group(2).strip()
                current_params[key] = value

    # Save last service
    if current_service and current_params:
        services[current_service] = _params_to_service(current_service, current_params)

    return services


def _params_to_service(name: str, params: dict[str, str]) -> PGService:
    """Convert parsed parameters to a PGService object.

    Args:
        name: Service name
        params: Parsed parameters

    Returns:
        PGService object
    """
    # Extract known parameters
    host = params.pop("host", "localhost")
    port = int(params.pop("port", "5432"))
    dbname = params.pop("dbname", params.pop("database", ""))
    user = params.pop("user", "")
    password = params.pop("password", "")
    sslmode = params.pop("sslmode", "")

    # Remaining params go to options
    return PGService(
        name=name,
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
        sslmode=sslmode,
        options=params,
    )


def list_services() -> list[str]:
    """List all available PostgreSQL service names.

    Returns:
        List of service names
    """
    services = parse_pg_service_file()
    return list(services.keys())


def get_service(name: str) -> PGService | None:
    """Get a specific PostgreSQL service by name.

    Args:
        name: Service name

    Returns:
        PGService object or None if not found
    """
    services = parse_pg_service_file()
    return services.get(name)


def write_service(service: PGService, path: Path | None = None) -> None:
    """Write or update a service in pg_service.conf.

    Args:
        service: PGService to write
        path: Path to service file (uses default if None)
    """
    if path is None:
        path = Path.home() / ".pg_service.conf"

    # Read existing content
    existing_services = parse_pg_service_file(path) if path.exists() else {}

    # Update with new service
    existing_services[service.name] = service

    # Write back
    with open(path, "w") as f:
        for name, svc in existing_services.items():
            f.write(f"[{name}]\n")
            f.write(f"host={svc.host}\n")
            f.write(f"port={svc.port}\n")
            if svc.dbname:
                f.write(f"dbname={svc.dbname}\n")
            if svc.user:
                f.write(f"user={svc.user}\n")
            if svc.password:
                f.write(f"password={svc.password}\n")
            if svc.sslmode:
                f.write(f"sslmode={svc.sslmode}\n")
            for key, value in svc.options.items():
                f.write(f"{key}={value}\n")
            f.write("\n")


def delete_service(name: str, path: Path | None = None) -> bool:
    """Delete a service from pg_service.conf.

    Args:
        name: Service name to delete
        path: Path to service file (uses default if None)

    Returns:
        True if service was found and deleted
    """
    if path is None:
        path = Path.home() / ".pg_service.conf"

    if not path.exists():
        return False

    existing_services = parse_pg_service_file(path)

    if name not in existing_services:
        return False

    del existing_services[name]

    # Write back without the deleted service
    with open(path, "w") as f:
        for svc_name, svc in existing_services.items():
            f.write(f"[{svc_name}]\n")
            f.write(f"host={svc.host}\n")
            f.write(f"port={svc.port}\n")
            if svc.dbname:
                f.write(f"dbname={svc.dbname}\n")
            if svc.user:
                f.write(f"user={svc.user}\n")
            if svc.password:
                f.write(f"password={svc.password}\n")
            if svc.sslmode:
                f.write(f"sslmode={svc.sslmode}\n")
            for key, value in svc.options.items():
                f.write(f"{key}={value}\n")
            f.write("\n")

    return True
