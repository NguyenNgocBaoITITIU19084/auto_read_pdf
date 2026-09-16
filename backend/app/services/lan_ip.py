"""Utility functions for detecting and ranking LAN IPv4 addresses."""

import socket
from ipaddress import IPv4Address, AddressValueError


def rank_ipv4(candidates: list[str], default_ip: str | None) -> list[str]:
    """
    Filter and rank IPv4 addresses for LAN detection.

    Filters out:
    - Loopback addresses (127.*)
    - Link-local addresses (169.254.*)
    - Zero address (0.0.0.0)
    - IPv6 addresses
    - Public IP addresses (not in private ranges)

    Keeps only private IP ranges:
    - 10/8 (10.0.0.0 - 10.255.255.255)
    - 172.16/12 (172.16.0.0 - 172.31.255.255)
    - 192.168/16 (192.168.0.0 - 192.168.255.255)

    Args:
        candidates: List of IP addresses to filter
        default_ip: IP address to place first (if valid). If provided and valid,
                   it will be moved to the front of the result.

    Returns:
        Filtered list of valid private IPv4 addresses, with default_ip first if provided.
    """
    valid_ips = []
    seen = set()

    for ip_str in candidates:
        # Skip if we've already seen this IP
        if ip_str in seen:
            continue

        try:
            ip = IPv4Address(ip_str)
        except AddressValueError:
            # Not a valid IPv4 address (might be IPv6 or malformed)
            continue

        # Filter out loopback, link-local, and zero addresses
        if ip.is_loopback or ip.is_link_local or ip == IPv4Address("0.0.0.0"):
            continue

        # Keep only private addresses
        if ip.is_private:
            valid_ips.append(ip_str)
            seen.add(ip_str)

    # If default_ip is provided and valid, move it to the front
    if default_ip is not None:
        try:
            default_ip_obj = IPv4Address(default_ip)
            # Check if default_ip is valid (private, not loopback, etc.)
            if default_ip_obj.is_private and not default_ip_obj.is_loopback and not default_ip_obj.is_link_local:
                # Remove it from valid_ips if it's there to avoid duplicates
                if default_ip in valid_ips:
                    valid_ips.remove(default_ip)
                # Put it at the front
                valid_ips.insert(0, default_ip)
            # If default_ip is not in valid_ips but is valid, add it to the front
            elif default_ip not in seen and default_ip not in valid_ips:
                if default_ip_obj.is_private and not default_ip_obj.is_loopback and not default_ip_obj.is_link_local:
                    valid_ips.insert(0, default_ip)
        except AddressValueError:
            # default_ip is not a valid IPv4 address, ignore it
            pass

    return valid_ips


def default_route_ip() -> str | None:
    """
    Detect the IP address associated with the default route.

    Uses a UDP socket connected to 10.255.255.255:1. This does not send any
    packets but allows the OS to select the appropriate interface based on the
    default route. Then we extract the local IP address.

    Returns:
        The IP address of the default route interface, or None if detection fails.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return None


def list_lan_ipv4() -> list[str]:
    """
    List all LAN IPv4 addresses on this machine.

    Combines default_route_ip() and rank_ipv4() to provide a ranked list of
    LAN IPv4 addresses, with the default route IP prioritized.

    Returns:
        A list of valid private IPv4 addresses, ranked with default_route_ip first.
    """
    candidates = [ai[4][0] for ai in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    return rank_ipv4(candidates, default_route_ip())
