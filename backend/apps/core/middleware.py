from django.conf import settings


class AppVersionHeaderMiddleware:
    """Adds X-App-Version to every response.

    Read from settings on every call (not cached at __init__) so
    `override_settings(APP_VERSION=...)` works in tests. The cost is
    one attribute access per response — irrelevant. The header is
    informative; the frontend uses it to detect that its bundle is
    stale and trigger a silent reload on the next navigation to a
    main route.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response["X-App-Version"] = settings.APP_VERSION
        return response
