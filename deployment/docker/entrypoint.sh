#!/bin/sh
set -e

echo "----------------------------------------------------"
echo "STARTING CLOUDBENCH $(date)"
echo "----------------------------------------------------"

cd /app

echo "Applying database migrations..."
python manage.py migrate --noinput

echo "Collecting static files..."
python manage.py collectstatic --noinput

if [ -n "$ADMIN_USERNAME" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo "Creating admin user..."
    echo "  ADMIN_USERNAME=[${ADMIN_USERNAME}] (length ${#ADMIN_USERNAME})"
    echo "  ADMIN_PASSWORD length ${#ADMIN_PASSWORD}, sha256 $(printf '%s' "$ADMIN_PASSWORD" | sha256sum | cut -c1-12)"
    python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
username = '${ADMIN_USERNAME}'
password = '${ADMIN_PASSWORD}'
user = User.objects.filter(username=username).first()
if user is None:
    User.objects.create_superuser(username=username, password=password)
    print(f'Superuser {username!r} created.')
else:
    user.set_password(password)
    user.is_superuser = True
    user.is_staff = True
    user.save(update_fields=['password', 'is_superuser', 'is_staff'])
    print(f'Superuser {username!r} already exists, password and superuser status updated.')
"
else
    echo "Skipping admin user creation (ADMIN_USERNAME/ADMIN_PASSWORD not set)."
fi

echo "----------------------------------------------------"
echo "READY"
echo "----------------------------------------------------"

exec "$@"