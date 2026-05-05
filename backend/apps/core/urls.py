from django.urls import path

from .views import SeedView, health_check, version_info

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("version/", version_info, name="version-info"),
    path("internal/seed/", SeedView.as_view(), name="seed"),
]
