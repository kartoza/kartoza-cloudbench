.PHONY: all build build-web build-tui build-frontend clean clean-all dev dev-web dev-tui \
        install test lint format shell migrate kill-server redeploy help \
        docs docs-build \
        deploy-build deploy-up deploy-up-prod deploy-down deploy-logs \
        deploy-shell deploy-migrate deploy-test

# Version from git tag or commit
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

# Python settings
PYTHON := python
PIP := pip
DJANGO_SETTINGS := cloudbench.settings.development

# Default target
all: build

# === Python/Django Web Server ===

# Build the web application (frontend + collect static)
build-web: build-frontend
	@echo "Collecting static files..."
	$(PYTHON) manage.py collectstatic --noinput

# Build the React frontend
build-frontend:
	@echo "Building React frontend..."
	cd web && npm install && npm run build
	@echo "Copying frontend to static directory..."
	rm -rf static/*
	cp -r internal/webserver/static/* static/ 2>/dev/null || cp -r web/dist/* static/ 2>/dev/null || true

# Run Django development server
dev-web:
	@echo "Starting Django development server on http://localhost:8080..."
	DJANGO_SETTINGS_MODULE=$(DJANGO_SETTINGS) $(PYTHON) manage.py runserver 0.0.0.0:8080

# Run Django with uvicorn (ASGI)
run-web:
	@echo "Starting Django with uvicorn on http://localhost:8080..."
	uvicorn cloudbench.asgi:application --host 0.0.0.0 --port 8080 --reload

# === TUI Application ===

# Build the TUI application
build-tui:
	@echo "TUI is a Python application, no build step required."
	@echo "Run 'make dev-tui' or 'python -m tui' to start."

# Run TUI in development mode
dev-tui:
	@echo "Starting CloudBench TUI..."
	$(PYTHON) -m tui

# Run TUI
run-tui: dev-tui

# === Combined Build ===

build: build-web build-tui
	@echo "Build complete!"

# === Database Migrations ===

# Create and apply migrations
migrate:
	$(PYTHON) manage.py migrate

# Make migrations
makemigrations:
	$(PYTHON) manage.py makemigrations

# === Django Shell ===

shell:
	$(PYTHON) manage.py shell

# === Testing ===

# Run all tests
test:
	@echo "Running all tests..."
	pytest tests/

# Run unit tests only (fast)
test-unit:
	@echo "Running unit tests..."
	pytest tests/unit -v -m "unit or not integration"

# Run API tests
test-api:
	@echo "Running API tests..."
	pytest tests/api -v -m "api"

# Run integration tests (requires services)
test-integration:
	@echo "Running integration tests..."
	pytest tests/integration -v -m "integration"

# Run TUI tests
test-tui:
	@echo "Running TUI tests..."
	pytest tests/tui -v -m "tui"

# Run E2E tests (requires browser)
test-e2e:
	@echo "Running E2E tests..."
	pytest tests/e2e -v -m "e2e"

# Run frontend tests
test-frontend:
	@echo "Running frontend tests..."
	cd web && npm run test

# Run all tests with coverage
test-coverage:
	@echo "Running tests with coverage..."
	pytest tests/ --cov=apps --cov=cloudbench --cov=tui --cov-report=html --cov-report=xml
	cd web && npm run test:coverage

# Run quick pre-commit tests
test-quick:
	@echo "Running quick tests for pre-commit..."
	pytest tests/unit -v -m "unit" --tb=short -q
	cd web && npm run test -- --run --reporter=dot

# Install Playwright browsers
install-playwright:
	@echo "Installing Playwright browsers..."
	playwright install --with-deps chromium

# === Linting and Formatting ===

lint:
	@echo "Running ruff..."
	ruff check apps cloudbench tui
	@echo "Running mypy..."
	mypy apps cloudbench tui

format:
	@echo "Formatting with black..."
	black apps cloudbench tui
	@echo "Sorting imports with ruff..."
	ruff check --fix --select I apps cloudbench tui

# === Documentation ===

docs:
	@echo "Serving documentation on http://localhost:8000..."
	mkdocs serve

docs-build:
	@echo "Building documentation..."
	mkdocs build

# === Cleaning ===

clean:
	@echo "Cleaning..."
	rm -rf static/*
	rm -rf staticfiles/*
	rm -rf web/node_modules
	rm -rf .pytest_cache
	rm -rf .mypy_cache
	rm -rf .ruff_cache
	rm -rf htmlcov
	rm -rf *.egg-info
	rm -rf dist
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true

clean-all: clean
	@echo "Deep cleaning..."
	rm -rf .venv
	rm -rf node_modules
	rm -rf web/node_modules

# === Server Management ===

kill-server:
	@echo "Killing any running server instances..."
	@fuser -k 8080/tcp 2>/dev/null || true
	@sleep 1

redeploy: kill-server clean build-web
	@echo ""
	@echo "================================================"
	@echo "Build complete! Starting server..."
	@echo "================================================"
	@echo ""
	$(PYTHON) manage.py runserver 0.0.0.0:8080 &
	@sleep 2
	@echo ""
	@echo "Server started on http://localhost:8080"

# === Installation ===

install:
	@echo "Installing dependencies..."
	$(PIP) install -e ".[dev]"

# === Standalone Deployment (Docker) ===
# Thin passthrough to deployment/Makefile so you don't need to `cd deployment`
# first. Requires deployment/.env (copy from deployment/.template.env).

deploy-build:
	@$(MAKE) -C deployment build

# Dev mode: source-mounted, picks up docker-compose.override.yml automatically.
deploy-up:
	@$(MAKE) -C deployment up

# Production mode: base compose file only, no source mounts.
deploy-up-prod:
	@$(MAKE) -C deployment up-prod

deploy-down:
	@$(MAKE) -C deployment down

deploy-logs:
	@$(MAKE) -C deployment logs

deploy-shell:
	@$(MAKE) -C deployment shell

deploy-migrate:
	@$(MAKE) -C deployment migrate

deploy-test:
	@$(MAKE) -C deployment test

# === Legacy Go Targets (for backward compatibility during migration) ===

build-go-tui:
	@echo "Building Go TUI..."
	go build -ldflags "-X main.version=$(VERSION)" -o bin/kartoza-cloudbench-go .

build-go-web:
	@echo "Building Go Web server..."
	go build -ldflags "-X main.version=$(VERSION)" -o bin/kartoza-cloudbench-web-go ./cmd/web

# === Help ===

help:
	@echo "Kartoza CloudBench - Build Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Django/Python Targets:"
	@echo "  dev-web          Run Django development server (port 8080)"
	@echo "  run-web          Run Django with uvicorn (ASGI)"
	@echo "  dev-tui          Run the Textual TUI"
	@echo "  build-web        Build frontend and collect static files"
	@echo "  build-frontend   Build React frontend only"
	@echo "  migrate          Run database migrations"
	@echo "  shell            Open Django shell"
	@echo ""
	@echo "Testing & Quality:"
	@echo "  test             Run all tests"
	@echo "  test-unit        Run unit tests only (fast)"
	@echo "  test-api         Run API tests"
	@echo "  test-integration Run integration tests (requires services)"
	@echo "  test-tui         Run TUI tests"
	@echo "  test-e2e         Run E2E tests (requires browser)"
	@echo "  test-frontend    Run frontend tests"
	@echo "  test-coverage    Run tests with coverage report"
	@echo "  test-quick       Run quick pre-commit tests"
	@echo "  lint             Run ruff and mypy"
	@echo "  format           Format code with black"
	@echo ""
	@echo "Documentation:"
	@echo "  docs             Serve documentation locally"
	@echo "  docs-build       Build documentation site"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean            Remove build artifacts"
	@echo "  clean-all        Deep clean including venv"
	@echo "  install          Install package with dev dependencies"
	@echo "  kill-server      Kill running server instances"
	@echo "  redeploy         Kill, clean, rebuild, restart"
	@echo ""
	@echo "Standalone Deployment (Docker, see deployment/.template.env):"
	@echo "  deploy-build     Build the production Docker image"
	@echo "  deploy-up        Start full stack in dev mode (source-mounted)"
	@echo "  deploy-up-prod   Start full stack in production mode"
	@echo "  deploy-down      Stop the deployment stack"
	@echo "  deploy-logs      Follow logs from all deployment services"
	@echo "  deploy-shell     Open Django shell inside the django container"
	@echo "  deploy-migrate   Run migrations inside the django container"
	@echo "  deploy-test      Run tests inside the django container"
	@echo ""
	@echo "Legacy Go Targets:"
	@echo "  build-go-tui     Build Go TUI binary"
	@echo "  build-go-web     Build Go web server binary"
	@echo ""
	@echo "  help             Show this help message"
