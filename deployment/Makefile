export COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml

# Build the Docker image (with frontend)
build:
	docker compose build django --no-cache

# Start all services (dev mode with source mounts)
up:
	docker compose up -d

# Start production services (no override file)
up-prod:
	COMPOSE_FILE=docker-compose.yml docker compose up -d

# Start the SSH debug container (PyCharm remote interpreter) and the
# frontend dev server
dev:
	docker compose --profile dev up -d dev vite

# Stop all services (including the dev/vite profile)
down:
	docker compose --profile dev down

# Follow logs
logs:
	docker compose logs -f

# Follow frontend (vite) logs
logs-vite:
	docker compose logs -f vite

# Open a shell inside the running vite container
shell-vite:
	docker compose exec vite sh

# Open Django shell inside container
shell:
	docker compose exec django python manage.py shell

# Run migrations inside container
migrate:
	docker compose exec django python manage.py migrate

# Collect static files inside container
collectstatic:
	docker compose exec django python manage.py collectstatic --noinput

# Run tests inside container
test:
	docker compose exec django pytest tests/

# Print image tag
image:
	@echo ghcr.io/kartoza/kartoza-cloudbench:${CLOUDBENCH_TAG:-latest}