.PHONY: all build build-tui build-web build-web-frontend clean clean-all dev-web dev-tui install test help redeploy kill-server

# Version from git tag or commit
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-X main.version=$(VERSION)"

# Default target
all: build

# Build both TUI and Web binaries
build: build-tui build-web

# Build the TUI binary
build-tui:
	@echo "Building TUI..."
	go build $(LDFLAGS) -o bin/kartoza-cloudbench-client .

# Build the Web binary (includes building frontend first)
build-web: build-web-frontend
	@echo "Building Web server..."
	go build $(LDFLAGS) -o bin/kartoza-cloudbench ./cmd/web

# Build the React frontend
build-web-frontend:
	@echo "Building React frontend..."
	cd web && npm install && npm run build

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf bin/
	rm -rf web/node_modules
	rm -rf internal/webserver/static/*.js
	rm -rf internal/webserver/static/*.css
	rm -rf internal/webserver/static/*.html
	rm -rf internal/webserver/static/assets
	rm -rf cloudbench

# Deep clean - also clears Go build cache
clean-all: clean
	@echo "Clearing Go build cache..."
	go clean -cache || true

# Development mode for web (runs Vite dev server and Go server)
dev-web:
	@echo "Starting development servers..."
	@echo "Run 'cd web && npm run dev' in one terminal"
	@echo "Run 'go run ./cmd/web' in another terminal"

# Development mode for TUI
dev-tui:
	go run ./cmd/tui

# Run the web server
run-web: build-web
	./bin/kartoza-cloudbench

# Run the TUI
run-tui: build-tui
	./bin/kartoza-cloudbench-client

# Install binaries to GOPATH/bin
install: build
	@echo "Installing binaries..."
	go install $(LDFLAGS) .
	go install $(LDFLAGS) ./cmd/web

# Run tests
test:
	go test -v ./...

# Kill any running server instances on port 8080
kill-server:
	@echo "Killing any running server instances..."
	@fuser -k 8080/tcp 2>/dev/null || true
	@sleep 1

# Full redeploy: kill server, deep clean, rebuild everything, and start server
# Note: Run this inside 'nix develop' shell for GDAL tools support
redeploy: kill-server clean-all build-web
	@echo ""
	@echo "================================================"
	@echo "Build complete! Starting server..."
	@echo "================================================"
	@echo ""
	./bin/kartoza-cloudbench &
	@sleep 2
	@echo ""
	@echo "Server started on http://localhost:8080"
	@echo "To run with GDAL tools support, use:"
	@echo "  nix develop --command ./bin/kartoza-cloudbench"

# Show help
help:
	@echo "Kartoza GeoServer Client - Build Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  all              Build both TUI and Web binaries (default)"
	@echo "  build            Build both TUI and Web binaries"
	@echo "  build-tui        Build the TUI binary only"
	@echo "  build-web        Build the Web binary (includes React frontend)"
	@echo "  build-web-frontend  Build the React frontend only"
	@echo "  clean            Remove build artifacts"
	@echo "  clean-all        Deep clean including Go build cache"
	@echo "  dev-web          Instructions for web development mode"
	@echo "  dev-tui          Run TUI in development mode"
	@echo "  run-web          Build and run the web server"
	@echo "  run-tui          Build and run the TUI"
	@echo "  install          Install binaries to GOPATH/bin"
	@echo "  test             Run tests"
	@echo "  kill-server      Kill any running server instances"
	@echo "  redeploy         Kill, clean, rebuild, and restart server"
	@echo "  help             Show this help message"
