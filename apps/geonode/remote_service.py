"""GeoNode remote service with session-based authentication."""

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx
from lxml import html

from apps.core.config import get_config
from apps.core.models import GeoNodeConnection


@dataclass
class RemoteService:
    """A GeoNode remote service entry."""

    id: int
    name: str
    base_url: str
    type: str
    method: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "baseUrl": self.base_url,
            "type": self.type,
            "method": self.method,
        }


class GeoNodeRemoteService:
    """Remote service that logs in to GeoNode before making requests."""

    LOGIN_PATH = "/en-us/admin/login/"
    SERVICES_PATH = "/en-us/admin/services/service/"

    def __init__(self, connection: GeoNodeConnection):
        self.connection = connection
        self._logged_in = False
        self.client = httpx.Client(
            base_url=connection.url.rstrip("/"),
            timeout=30.0,
            follow_redirects=True,
        )

    def login(self) -> None:
        """Perform Django admin session login."""
        # Fetch login page to get CSRF token
        response = self.client.get(self.LOGIN_PATH)
        response.raise_for_status()

        csrf_token = self.client.cookies.get("csrftoken")
        if not csrf_token:
            tree = html.fromstring(response.content)
            inputs = tree.xpath(
                "//input[@name='csrfmiddlewaretoken']/@value"
            )
            csrf_token = inputs[0] if inputs else ""

        response = self.client.post(
            self.LOGIN_PATH,
            data={
                "username": self.connection.username,
                "password": self.connection.password,
                "csrfmiddlewaretoken": csrf_token,
                "next": "/en-us/admin/",
            },
            headers={"Referer": str(self.client.base_url) + self.LOGIN_PATH},
        )
        response.raise_for_status()

        if "sessionid" not in self.client.cookies:
            raise PermissionError(
                "Login failed — invalid credentials or non-admin user"
            )

        self._logged_in = True

    def _ensure_logged_in(self) -> None:
        if not self._logged_in:
            self.login()

    def list_services(self) -> list[RemoteService]:
        """Fetch and parse the list of remote services from GeoNode admin."""
        self._ensure_logged_in()

        response = self.client.get(self.SERVICES_PATH)
        response.raise_for_status()

        return _parse_services_table(response.content)

    def create_service(
            self,
            base_url: str,
            service_type: str = "WMS",
    ) -> None:
        """Register a new remote service via /services/register/."""
        self._ensure_logged_in()

        register_path = "/services/register/"

        # GET to obtain a fresh CSRF token
        response = self.client.get(register_path)
        response.raise_for_status()

        csrf_token = self.client.cookies.get("csrftoken", "")
        if not csrf_token:
            tree = html.fromstring(response.content)
            inputs = tree.xpath("//input[@name='csrfmiddlewaretoken']/@value")
            csrf_token = inputs[0] if inputs else ""

        response = self.client.post(
            register_path,
            data={
                "csrfmiddlewaretoken": csrf_token,
                "url": base_url,
                "type": service_type,
            },
            headers={"Referer": str(self.client.base_url) + register_path},
        )
        response.raise_for_status()
        _raise_if_form_errors(response.content)

    def rescan_service(self, service_id: int) -> None:
        """Trigger a rescan of a remote service."""
        self._ensure_logged_in()

        rescan_path = f"/services/{service_id}/rescan"

        response = self.client.get(rescan_path)
        response.raise_for_status()

    def list_harvest_resources(self, service_id: int) -> list[dict]:
        """Return available resources from the GeoNode harvest page."""
        self._ensure_logged_in()
        self.rescan_service(service_id)
        harvest_path = f"/services/{service_id}/harvest"
        response = self.client.get(harvest_path)
        response.raise_for_status()
        return _parse_harvest_resources(response.content)

    def import_resources(
            self, service_id: int, resource_ids: list[int] | None = None
    ) -> list[dict]:
        """Rescan service then import selected resources via the harvest page."""
        self._ensure_logged_in()
        harvest_path = f"/services/{service_id}/harvest"

        response = self.client.get(harvest_path)
        response.raise_for_status()

        tree = html.fromstring(response.content)

        csrf_token = self.client.cookies.get("csrftoken", "")
        if not csrf_token:
            inputs = tree.xpath("//input[@name='csrfmiddlewaretoken']/@value")
            csrf_token = inputs[0] if inputs else ""

        available: list[dict] = []
        for cb in tree.xpath("//input[@name='resource_list']"):
            available.append({"id": cb.get("value")})

        ids_to_import = resource_ids if resource_ids is not None else [
            int(r["id"]) for r in available if r.get("id")
        ]

        data = {
            "csrfmiddlewaretoken": csrf_token,
            "typeahead_search": "",
            "resource_list": [str(rid) for rid in ids_to_import],
        }

        response = self.client.post(
            harvest_path,
            data=data,
            headers={"Referer": str(self.client.base_url) + harvest_path},
        )
        response.raise_for_status()

        return available

    def delete_service(self, service_id: int) -> None:
        """Delete a remote service via the GeoNode admin delete page."""
        self._ensure_logged_in()

        delete_path = f"{self.SERVICES_PATH}{service_id}/delete/"

        # GET the delete confirmation page to obtain the CSRF token
        response = self.client.get(delete_path)
        response.raise_for_status()

        csrf_token = self.client.cookies.get("csrftoken", "")
        if not csrf_token:
            tree = html.fromstring(response.content)
            inputs = tree.xpath("//input[@name='csrfmiddlewaretoken']/@value")
            csrf_token = inputs[0] if inputs else ""

        # POST to confirm deletion
        response = self.client.post(
            delete_path,
            data={
                "csrfmiddlewaretoken": csrf_token,
                "post": "yes",
            },
            headers={"Referer": str(self.client.base_url) + delete_path},
        )
        response.raise_for_status()

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        self.login()
        return self

    def __exit__(self, *_):
        self.close()


def _parse_harvest_resources(content: bytes) -> list[dict]:
    """Parse available resources from the GeoNode harvest page.

    Tries the JS resources.push(...) array first,
    then falls back to parsing table rows.
    """
    text = content.decode("utf-8", errors="replace")
    resources: list[dict] = []

    # 1️⃣ Try parsing JS array
    for match in re.findall(r"resources\.push\((\{[^}]+\})\)", text):
        try:
            resource = json.loads(match.replace("'", '"'))
            resources.append(resource)
        except (ValueError, KeyError):
            continue

    if resources:
        return resources

    # 2️⃣ Fallback: parse table rows
    tree = html.fromstring(content)
    rows = tree.xpath("//tr[td/input[@name='resource_list']]")

    for row in rows:
        checkbox = row.xpath(".//input[@name='resource_list']")[0]
        cols = row.xpath("./td")

        resources.append({
            "id": checkbox.get("value", ""),
            "name": cols[1].text_content().strip() if len(cols) > 1 else "",
            "title": cols[2].text_content().strip() if len(cols) > 2 else "",
            "abstract": cols[3].text_content().strip() if len(
                cols) > 3 else "",
            "type": cols[4].text_content().strip() if len(cols) > 4 else "",
        })

    return resources


def _parse_services_table(content: bytes) -> list[RemoteService]:
    """Parse the Django admin services table HTML."""
    tree = html.fromstring(content)
    rows = tree.xpath("//table[@id='result_list']/tbody/tr")

    services = []
    for row in rows:
        cells = row.xpath(".//td | .//th")
        if len(cells) < 6:
            continue

        # columns: checkbox, id, name, base_url, type, method
        service_id = _text(cells[1])
        name = _text(cells[2])
        base_url = _text(cells[3])
        service_type = _text(cells[4])
        method = _text(cells[5])

        try:
            services.append(
                RemoteService(
                    id=int(service_id),
                    name=name,
                    base_url=base_url,
                    type=service_type,
                    method=method,
                )
            )
        except (ValueError, IndexError):
            continue

    return services


def _text(element) -> str:
    return (element.text_content() or "").strip()


def _raise_if_form_errors(content: bytes) -> None:
    """Raise ValueError if the Django admin response contains form errors."""
    if b"Could not connect" in content:
        raise ValueError("Could not connect to the remote service.")

    tree = html.fromstring(content)

    # A top-level errornote means the form was re-rendered with errors
    errornote = tree.xpath("//*[contains(@class,'errornote')]")
    if not errornote:
        return

    # Collect every non-empty errorlist item, tagged with its field name
    errors: list[str] = []
    for row in tree.xpath("//*[contains(@class,'grp-errors')]"):
        field_label = _text(row.xpath(".//*[@class='c-1']")[0]) if row.xpath(
            ".//*[@class='c-1']") else ""
        for li in row.xpath(".//ul[contains(@class,'errorlist')]/li"):
            msg = _text(li)
            if msg:
                errors.append(f"{field_label}: {msg}" if field_label else msg)

    # Fall back to any errorlist on the page if grp-errors found nothing
    if not errors:
        for li in tree.xpath("//ul[contains(@class,'errorlist')]/li"):
            msg = _text(li)
            if msg:
                errors.append(msg)

    raise ValueError(
        "GeoNode admin rejected the form: " + "; ".join(errors) if errors
        else "GeoNode admin returned form errors (no details extracted)"
    )


def get_remote_service(
        connection_id: str, user_id: str = "default"
) -> GeoNodeRemoteService:
    """Build a GeoNodeRemoteService from a saved connection."""
    conn = get_config(user_id).get_geonode_connection(connection_id)
    if not conn:
        raise ValueError(f"GeoNode connection not found: {connection_id}")
    return GeoNodeRemoteService(conn)
