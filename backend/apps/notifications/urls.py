from django.urls import path

from .views import subscribe, test_push, unsubscribe, vapid_public_key

urlpatterns = [
    path("subscribe/", subscribe, name="push-subscribe"),
    path("unsubscribe/", unsubscribe, name="push-unsubscribe"),
    path("test/", test_push, name="push-test"),
    path("vapid-public-key/", vapid_public_key, name="vapid-public-key"),
]
