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

# Stop all services
down:
	docker compose down

# Follow logs
logs:
	docker compose logs -f

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
	@echo kartoza/cloudbench:${CLOUDBENCH_TAG:-latest}