.PHONY: all build build-tui build-web build-web-frontend clean dev-web dev-tui install test help

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
	go build $(LDFLAGS) -o bin/kartoza-geoserver-client .

# Build the Web binary (includes building frontend first)
build-web: build-web-frontend
	@echo "Building Web server..."
	go build $(LDFLAGS) -o bin/kartoza-geoserver-web ./cmd/web

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
	./bin/kartoza-geoserver-web

# Run the TUI
run-tui: build-tui
	./bin/kartoza-geoserver-client

# Install binaries to GOPATH/bin
install: build
	@echo "Installing binaries..."
	go install $(LDFLAGS) .
	go install $(LDFLAGS) ./cmd/web

# Run tests
test:
	go test -v ./...

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
	@echo "  dev-web          Instructions for web development mode"
	@echo "  dev-tui          Run TUI in development mode"
	@echo "  run-web          Build and run the web server"
	@echo "  run-tui          Build and run the TUI"
	@echo "  install          Install binaries to GOPATH/bin"
	@echo "  test             Run tests"
	@echo "  help             Show this help message"
