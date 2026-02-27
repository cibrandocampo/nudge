from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import RoutineEntryViewSet, RoutineViewSet, StockLotViewSet, StockViewSet, dashboard

router = DefaultRouter()
router.register(r"routines", RoutineViewSet, basename="routine")
router.register(r"stock", StockViewSet, basename="stock")
router.register(r"entries", RoutineEntryViewSet, basename="entry")

# Nested router for lots: /api/stock/{stock_pk}/lots/
lots_router = DefaultRouter()
lots_router.register(r"lots", StockLotViewSet, basename="stocklot")

urlpatterns = [
    path("", include(router.urls)),
    path("dashboard/", dashboard, name="dashboard"),
    path("stock/<int:stock_pk>/", include(lots_router.urls)),
]
