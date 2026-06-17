from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _server_blocks(config: str) -> list[str]:
    blocks: list[str] = []
    index = 0
    while True:
        start = config.find("server {", index)
        if start == -1:
            return blocks
        cursor = start + len("server {")
        depth = 1
        while cursor < len(config) and depth:
            if config[cursor] == "{":
                depth += 1
            elif config[cursor] == "}":
                depth -= 1
            cursor += 1
        blocks.append(config[start:cursor])
        index = cursor


def _location_block(server_block: str, location: str) -> str:
    start = server_block.find(location)
    if start == -1:
        return ""
    cursor = server_block.find("{", start)
    if cursor == -1:
        return ""
    cursor += 1
    depth = 1
    while cursor < len(server_block) and depth:
        if server_block[cursor] == "{":
            depth += 1
        elif server_block[cursor] == "}":
            depth -= 1
        cursor += 1
    return server_block[start:cursor]


def test_nginx_terminates_tls_and_redirects_plain_http() -> None:
    config = (ROOT / "nginx.conf").read_text()
    blocks = _server_blocks(config)

    http_block = next((block for block in blocks if "listen 80;" in block), "")
    tls_block = next((block for block in blocks if "listen 443 ssl" in block), "")

    assert http_block, "nginx must keep an HTTP listener for redirect-only traffic"
    assert "return 301 https://$host$request_uri;" in http_block
    assert "proxy_pass" not in http_block, "plain HTTP must not proxy bearer-token traffic"

    assert tls_block, "nginx must terminate HTTPS on port 443"
    assert "ssl_certificate /etc/letsencrypt/live/" in tls_block
    assert "ssl_certificate_key /etc/letsencrypt/live/" in tls_block
    assert "Strict-Transport-Security" in tls_block
    assert "proxy_pass http://backend;" in tls_block


def test_nginx_preserves_streaming_proxy_settings_on_https() -> None:
    config = (ROOT / "nginx.conf").read_text()
    tls_block = next(
        (block for block in _server_blocks(config) if "listen 443 ssl" in block),
        "",
    )
    chat_stream = _location_block(tls_block, "location = /chat/stream")
    conversation_stream = _location_block(tls_block, "location ~ ^/conversations/")

    assert "proxy_read_timeout 86400s;" not in tls_block
    assert "proxy_read_timeout 300s;" in _location_block(tls_block, "location /")
    assert "proxy_send_timeout 300s;" in _location_block(tls_block, "location /")
    for stream_location in (chat_stream, conversation_stream):
        assert stream_location
        assert "proxy_buffering off;" in stream_location
        assert "proxy_cache off;" in stream_location
        assert "proxy_read_timeout 3600s;" in stream_location
        assert "proxy_send_timeout 3600s;" in stream_location
    assert 'proxy_set_header Upgrade $http_upgrade;' in tls_block
    assert 'proxy_set_header Connection "upgrade";' in tls_block


def test_nginx_server_names_are_deployment_configured() -> None:
    config = (ROOT / "nginx.conf").read_text()

    assert "18.204.231.209" not in config
    assert "server_name 18." not in config
    assert "include /etc/nginx/conf.d/omnix-server-name*.conf;" in config


def test_nginx_admin_route_is_ip_restricted() -> None:
    config = (ROOT / "nginx.conf").read_text()
    tls_block = next(
        (block for block in _server_blocks(config) if "listen 443 ssl" in block),
        "",
    )
    admin_location = _location_block(tls_block, "location /admin/")

    assert admin_location
    assert "allow 127.0.0.1;" in admin_location
    assert "allow ::1;" in admin_location
    assert "include /etc/nginx/conf.d/omnix-admin-allow*.conf;" in admin_location
    assert "deny all;" in admin_location
    assert admin_location.index("deny all;") < admin_location.index("proxy_pass")
    assert "proxy_pass http://backend/admin/;" in admin_location
