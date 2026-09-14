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

echo "Creating admin user..."
python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
username = '${ADMIN_USERNAME:-admin}'
password = '${ADMIN_PASSWORD:-admin}'
email = '${ADMIN_EMAIL:-admin@example.com}'
if not User.objects.filter(username=username).exists():
    User.objects.create_superuser(username=username, email=email, password=password)
    print(f'Superuser {username!r} created.')
else:
    print(f'Superuser {username!r} already exists.')
"

echo "----------------------------------------------------"
echo "READY"
echo "----------------------------------------------------"

exec "$@"