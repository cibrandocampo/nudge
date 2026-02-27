from django.urls import path
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import admin_access, change_password, me


class AuthRateThrottle(AnonRateThrottle):
    scope = "auth"


urlpatterns = [
    path("token/", TokenObtainPairView.as_view(throttle_classes=[AuthRateThrottle]), name="token-obtain"),
    path("refresh/", TokenRefreshView.as_view(throttle_classes=[AuthRateThrottle]), name="token-refresh"),
    path("me/", me, name="auth-me"),
    path("change-password/", change_password, name="change-password"),
    path("admin-access/", admin_access, name="admin-access"),
]
