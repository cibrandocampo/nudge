from django.urls import path

from .views import SeedView, health_check, seed_allowed, version_info

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("version/", version_info, name="version-info"),
]

# Destructive and unauthenticated: in production the route does not exist.
if seed_allowed():
    urlpatterns.append(path("internal/seed/", SeedView.as_view(), name="seed"))
