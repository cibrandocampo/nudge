from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .throttles import AuthRateThrottle
from .views import (
    admin_access,
    auth_config,
    change_password,
    contact_delete,
    contact_list_create,
    login_start,
    login_verify,
    me,
)

urlpatterns = [
    path("token/", TokenObtainPairView.as_view(throttle_classes=[AuthRateThrottle]), name="token-obtain"),
    path("refresh/", TokenRefreshView.as_view(throttle_classes=[AuthRateThrottle]), name="token-refresh"),
    path("config/", auth_config, name="auth-config"),
    path("login/start/", login_start, name="login-start"),
    path("login/verify/", login_verify, name="login-verify"),
    path("me/", me, name="auth-me"),
    path("change-password/", change_password, name="change-password"),
    path("admin-access/", admin_access, name="admin-access"),
    path("contacts/", contact_list_create, name="contact-list-create"),
    path("contacts/<int:pk>/", contact_delete, name="contact-delete"),
]
