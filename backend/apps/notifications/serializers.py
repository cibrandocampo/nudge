from rest_framework import serializers


class PushSubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.CharField()
    keys = serializers.DictField(child=serializers.CharField())

    def validate_keys(self, value):
        if "p256dh" not in value or "auth" not in value:
            raise serializers.ValidationError("Keys must include p256dh and auth.")
        return value
