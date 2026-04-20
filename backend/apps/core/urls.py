from django.urls import path

from .views import E2ESeedView, health_check

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("internal/e2e-seed/", E2ESeedView.as_view(), name="e2e-seed"),
]
