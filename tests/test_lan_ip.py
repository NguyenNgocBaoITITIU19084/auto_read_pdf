import pytest
from unittest.mock import patch, MagicMock
from backend.app.services.lan_ip import rank_ipv4, default_route_ip, list_lan_ipv4


class TestRankIPv4:
    """Test the rank_ipv4 function."""

    def test_empty_candidates(self):
        """Test with empty candidates list."""
        result = rank_ipv4([], None)
        assert result == []

    def test_no_default_ip(self):
        """Test without default_ip."""
        candidates = ["192.168.1.1", "10.0.0.1", "172.16.0.1"]
        result = rank_ipv4(candidates, None)
        assert result == ["192.168.1.1", "10.0.0.1", "172.16.0.1"]

    def test_default_ip_first(self):
        """Test that default_ip is placed first."""
        candidates = ["192.168.1.2", "10.0.0.1", "172.16.0.1"]
        result = rank_ipv4(candidates, "192.168.1.2")
        assert result[0] == "192.168.1.2"
        assert len(result) == 3

    def test_default_ip_not_in_candidates(self):
        """Test default_ip that's not in candidates."""
        candidates = ["192.168.1.2", "10.0.0.1"]
        result = rank_ipv4(candidates, "172.16.0.1")
        # default_ip should still be first if it's valid
        assert result[0] == "172.16.0.1"
        assert "192.168.1.2" in result
        assert "10.0.0.1" in result

    def test_remove_loopback(self):
        """Test that loopback addresses (127.*) are filtered out."""
        candidates = ["127.0.0.1", "192.168.1.1"]
        result = rank_ipv4(candidates, None)
        assert "127.0.0.1" not in result
        assert result == ["192.168.1.1"]

    def test_remove_link_local(self):
        """Test that link-local addresses (169.254.*) are filtered out."""
        candidates = ["169.254.1.1", "192.168.1.1"]
        result = rank_ipv4(candidates, None)
        assert "169.254.1.1" not in result
        assert result == ["192.168.1.1"]

    def test_remove_zero_address(self):
        """Test that 0.0.0.0 is filtered out."""
        candidates = ["0.0.0.0", "192.168.1.1"]
        result = rank_ipv4(candidates, None)
        assert "0.0.0.0" not in result
        assert result == ["192.168.1.1"]

    def test_remove_ipv6(self):
        """Test that IPv6 addresses are filtered out."""
        candidates = ["::1", "2001:db8::1", "192.168.1.1"]
        result = rank_ipv4(candidates, None)
        assert "::1" not in result
        assert "2001:db8::1" not in result
        assert result == ["192.168.1.1"]

    def test_keep_private_10_range(self):
        """Test that 10/8 range is kept."""
        candidates = ["10.0.0.1", "10.255.255.255"]
        result = rank_ipv4(candidates, None)
        assert result == ["10.0.0.1", "10.255.255.255"]

    def test_keep_private_172_16_range(self):
        """Test that 172.16/12 range is kept."""
        candidates = ["172.16.0.1", "172.31.255.255"]
        result = rank_ipv4(candidates, None)
        assert result == ["172.16.0.1", "172.31.255.255"]

    def test_keep_private_192_168_range(self):
        """Test that 192.168/16 range is kept."""
        candidates = ["192.168.0.1", "192.168.255.255"]
        result = rank_ipv4(candidates, None)
        assert result == ["192.168.0.1", "192.168.255.255"]

    def test_remove_public_ips(self):
        """Test that public IPs are filtered out."""
        candidates = ["8.8.8.8", "1.1.1.1", "192.168.1.1"]
        result = rank_ipv4(candidates, None)
        assert "8.8.8.8" not in result
        assert "1.1.1.1" not in result
        assert result == ["192.168.1.1"]

    def test_remove_boundary_172_outside_range(self):
        """Test that 172.15.* and 172.32.* are filtered out."""
        candidates = ["172.15.255.255", "172.32.0.0", "172.16.0.1"]
        result = rank_ipv4(candidates, None)
        assert "172.15.255.255" not in result
        assert "172.32.0.0" not in result
        assert result == ["172.16.0.1"]

    def test_stable_order_preserved(self):
        """Test that stable order is preserved for non-default IPs."""
        candidates = ["192.168.1.1", "10.0.0.1", "172.16.0.1"]
        result = rank_ipv4(candidates, None)
        assert result == ["192.168.1.1", "10.0.0.1", "172.16.0.1"]

    def test_remove_duplicate_with_default(self):
        """Test that duplicates are removed when default_ip is in candidates."""
        candidates = ["192.168.1.1", "10.0.0.1", "192.168.1.1"]
        result = rank_ipv4(candidates, "192.168.1.1")
        assert result[0] == "192.168.1.1"
        assert result.count("192.168.1.1") == 1
        assert len(result) == 2

    def test_complex_scenario(self):
        """Test with complex mix of valid and invalid IPs."""
        candidates = [
            "127.0.0.1",          # loopback - remove
            "192.168.1.100",      # valid
            "169.254.1.1",        # link-local - remove
            "10.0.0.50",          # valid
            "0.0.0.0",            # zero - remove
            "8.8.8.8",            # public - remove
            "172.16.5.5",         # valid
            "172.15.0.1",         # outside 172.16/12 - remove
            "::1",                # IPv6 - remove
            "192.168.1.100",      # duplicate of 192.168.1.100
        ]
        result = rank_ipv4(candidates, "10.0.0.50")
        assert result[0] == "10.0.0.50"
        assert "127.0.0.1" not in result
        assert "169.254.1.1" not in result
        assert "0.0.0.0" not in result
        assert "8.8.8.8" not in result
        assert "172.15.0.1" not in result
        assert "::1" not in result
        assert result.count("192.168.1.100") == 1
        assert set(result) == {"10.0.0.50", "192.168.1.100", "172.16.5.5"}


class TestDefaultRouteIP:
    """Test the default_route_ip function."""

    @patch("socket.socket")
    def test_default_route_ip_success(self, mock_socket_class):
        """Test successful retrieval of default route IP."""
        mock_socket = MagicMock()
        mock_socket.getsockname.return_value = ("192.168.1.100", 0)
        mock_socket_class.return_value.__enter__.return_value = mock_socket

        result = default_route_ip()
        assert result == "192.168.1.100"
        mock_socket.connect.assert_called_once_with(("10.255.255.255", 1))

    @patch("socket.socket")
    def test_default_route_ip_error(self, mock_socket_class):
        """Test when getting default route IP fails."""
        mock_socket = MagicMock()
        mock_socket.connect.side_effect = OSError("Network is unreachable")
        mock_socket_class.return_value.__enter__.return_value = mock_socket

        result = default_route_ip()
        assert result is None


class TestListLANIPv4:
    """Test the list_lan_ipv4 function."""

    @patch("backend.app.services.lan_ip.default_route_ip")
    @patch("socket.getaddrinfo")
    def test_list_lan_ipv4(self, mock_getaddrinfo, mock_default_route_ip):
        """Test list_lan_ipv4 with mock data."""
        mock_default_route_ip.return_value = "192.168.1.100"
        # socket.getaddrinfo returns tuples of (family, type, proto, canonname, sockaddr)
        # We only care about sockaddr[0] which is the IP address
        mock_getaddrinfo.return_value = [
            (2, 1, 6, "", ("192.168.1.100", 0)),
            (2, 1, 6, "", ("10.0.0.1", 0)),
            (2, 1, 6, "", ("127.0.0.1", 0)),
        ]

        result = list_lan_ipv4()
        assert result[0] == "192.168.1.100"
        assert "10.0.0.1" in result
        assert "127.0.0.1" not in result

    @patch("backend.app.services.lan_ip.default_route_ip")
    @patch("socket.getaddrinfo")
    def test_list_lan_ipv4_no_default_route(self, mock_getaddrinfo, mock_default_route_ip):
        """Test list_lan_ipv4 when default_route_ip returns None."""
        mock_default_route_ip.return_value = None
        mock_getaddrinfo.return_value = [
            (2, 1, 6, "", ("192.168.1.100", 0)),
            (2, 1, 6, "", ("10.0.0.1", 0)),
        ]

        result = list_lan_ipv4()
        assert "192.168.1.100" in result
        assert "10.0.0.1" in result
        assert len(result) == 2
