from rest_framework.test import APITestCase


class HealthCheckTestCase(APITestCase):
    def test_returns_200(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)

    def test_returns_ok_status(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.json(), {"status": "ok"})

    def test_no_authentication_required(self):
        # Health endpoint must be publicly accessible
        response = self.client.get("/api/health/")
        self.assertNotEqual(response.status_code, 401)
