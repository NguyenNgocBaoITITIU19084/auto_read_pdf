from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_dashboard_summary_api():
    response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200
    data = response.json()
    assert "kpis" in data
    assert "alerts" in data
    assert "distributions" in data
    assert "updated_at" in data
    assert "scope" in data
    assert data["kpis"]["total_bookings"] >= 0
