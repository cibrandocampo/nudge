from rest_framework.permissions import BasePermission


class IsOwner(BasePermission):
    """Object-level permission: only the resource's `user` can write.

    Apply via ViewSet.get_permissions() in viewsets that already filter
    visibility (read access) at the queryset level. The permission is
    enforced by DRF's check_object_permissions, called automatically by
    self.get_object() in detail-view methods (update, partial_update,
    destroy).
    """

    message = "Only the owner can modify this resource."

    def has_object_permission(self, request, view, obj):
        return obj.user == request.user
