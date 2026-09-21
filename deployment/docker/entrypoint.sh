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
    user.save(update_fields=['password'])
    print(f'Superuser {username!r} already exists, password updated.')
"
else
    echo "Skipping admin user creation (ADMIN_USERNAME/ADMIN_PASSWORD not set)."
fi

echo "----------------------------------------------------"
echo "READY"
echo "----------------------------------------------------"

exec "$@"