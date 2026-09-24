export COMPOSE_FILE=docker-compose.yml

# Override any of these via env vars or a .env file in this directory.
MINIO_ROOT_USER ?= minioadmin
MINIO_ROOT_PASSWORD ?= minioadmin
MINIO_PORT ?= 9000
MINIO_CONSOLE_PORT ?= 9001
MINIO_DEFAULT_BUCKET ?= geospatial-data

export MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_PORT MINIO_CONSOLE_PORT MINIO_DEFAULT_BUCKET

.PHONY: build up down restart logs status creds accesskey console mc clean help

# Pull the minio/mc images used by docker-compose.yml
build:
	docker compose pull

# Start MinIO and create the default bucket
up:
	docker compose up -d
	@echo ""
	@echo "MinIO API:     http://localhost:$(MINIO_PORT)"
	@echo "MinIO Console: http://localhost:$(MINIO_CONSOLE_PORT)"
	@echo "Bucket:        $(MINIO_DEFAULT_BUCKET)"
	@echo "Credentials:   $(MINIO_ROOT_USER) / $(MINIO_ROOT_PASSWORD)"

# Stop MinIO (keeps the data volume)
down:
	docker compose down

restart: down up

# Follow MinIO logs
logs:
	docker compose logs -f minio

# Show container status
status:
	docker compose ps

# Print the values to paste into the app's "Add S3 Connection" dialog
creds:
	@echo "Endpoint:    localhost:$(MINIO_PORT)"
	@echo "Access Key:  $(MINIO_ROOT_USER)"
	@echo "Secret Key:  $(MINIO_ROOT_PASSWORD)"
	@echo "Use SSL:     false"
	@echo "Path Style:  true"
	@echo "Bucket:      $(MINIO_DEFAULT_BUCKET)"

# Create a non-root access/secret key pair (MinIO's Console dropped
# self-serve key creation in recent releases — this is CLI-only now)
accesskey:
	@docker compose run --rm --entrypoint sh minio-setup -c \
		"mc alias set local http://minio:9000 $(MINIO_ROOT_USER) $(MINIO_ROOT_PASSWORD) >/dev/null && mc admin accesskey create local $(MINIO_ROOT_USER)"

# Open the MinIO web console in your browser
console:
	@echo "Opening http://localhost:$(MINIO_CONSOLE_PORT) ..."
	@xdg-open "http://localhost:$(MINIO_CONSOLE_PORT)" 2>/dev/null \
		|| open "http://localhost:$(MINIO_CONSOLE_PORT)" 2>/dev/null \
		|| echo "Open http://localhost:$(MINIO_CONSOLE_PORT) manually"

# Open an mc (MinIO Client) shell against the running instance
mc:
	docker compose run --rm --entrypoint sh minio-setup -c \
		"mc alias set local http://minio:9000 $(MINIO_ROOT_USER) $(MINIO_ROOT_PASSWORD) && sh"

# Stop MinIO and delete all data (irreversible)
clean:
	docker compose down -v

help:
	@echo "Kartoza CloudBench - S3/MinIO test stack"
	@echo ""
	@echo "  make build     Pull the minio/mc images"
	@echo "  make up        Start MinIO and create the default bucket"
	@echo "  make down      Stop MinIO (keeps data)"
	@echo "  make restart   Restart the stack"
	@echo "  make logs      Follow MinIO logs"
	@echo "  make status    Show container status"
	@echo "  make creds     Print connection details for the app's S3 dialog"
	@echo "  make accesskey Create a non-root access/secret key pair"
	@echo "  make console   Open the MinIO web console"
	@echo "  make mc        Open an mc shell against the running instance"
	@echo "  make clean     Stop MinIO and delete all data"
