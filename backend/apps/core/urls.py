from django.urls import path

from .views import SeedView, health_check

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("internal/seed/", SeedView.as_view(), name="seed"),
]
