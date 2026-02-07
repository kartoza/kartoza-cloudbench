{
  description = "Kartoza GeoServer Client - Dual-panel TUI for managing GeoServer";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version = "0.1.0";

        # MkDocs with Material theme for documentation
        mkdocsEnv = pkgs.python3.withPackages (ps: with ps; [
          mkdocs
          mkdocs-material
          mkdocs-minify-plugin
          pygments
          pymdown-extensions
        ]);

        # Test GeoServer configuration
        geoserverContainer = "kartoza-geoserver-test";
        geoserverPort = "8600";
        geoserverUser = "admin";
        geoserverPass = "geoserver";

      in
      {
        packages = {
          default = pkgs.buildGoModule {
            pname = "kartoza-geoserver-client";
            inherit version;
            src = ./.;

            vendorHash = null;

            ldflags = [
              "-s"
              "-w"
              "-X main.version=${version}"
            ];

            meta = with pkgs.lib; {
              description = "Dual-panel TUI for managing GeoServer instances";
              homepage = "https://github.com/kartoza/kartoza-geoserver-client";
              license = licenses.mit;
              maintainers = [ ];
              platforms = platforms.unix;
            };
          };

          kartoza-geoserver-client = self.packages.${system}.default;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Go toolchain
            go
            gopls
            golangci-lint
            gomodifytags
            gotests
            impl
            delve
            go-tools

            # Build tools
            gnumake
            gcc
            pkg-config

            # CLI utilities
            ripgrep
            fd
            eza
            bat
            fzf
            tree
            jq
            yq

            # Documentation
            mkdocsEnv

            # Nix tools
            nil
            nixpkgs-fmt
            nixfmt-classic

            # Git
            git
            gh

            # Docker for test environment
            docker
          ];

          shellHook = ''
            export EDITOR=nvim
            export GOPATH="$PWD/.go"
            export GOCACHE="$PWD/.go/cache"
            export GOMODCACHE="$PWD/.go/pkg/mod"
            export PATH="$GOPATH/bin:$PATH"

            # Test GeoServer configuration
            export GEOSERVER_CONTAINER="${geoserverContainer}"
            export GEOSERVER_PORT="${geoserverPort}"
            export GEOSERVER_USER="${geoserverUser}"
            export GEOSERVER_PASS="${geoserverPass}"
            export GEOSERVER_URL="http://localhost:${geoserverPort}/geoserver"

            # Helpful aliases
            alias gor='go run .'
            alias got='go test -v ./...'
            alias gob='go build -o bin/kartoza-geoserver-client .'
            alias gom='go mod tidy'
            alias gol='golangci-lint run'

            # Documentation aliases
            alias docs='mkdocs serve'
            alias docs-build='mkdocs build'

            # GeoServer test environment commands as exported functions
            export -f geoserver-start 2>/dev/null || true
            geoserver-start() {
              echo "Starting test GeoServer on port ${geoserverPort}..."
              docker run -d \
                --name ${geoserverContainer} \
                -p ${geoserverPort}:8080 \
                -e GEOSERVER_ADMIN_USER=${geoserverUser} \
                -e GEOSERVER_ADMIN_PASSWORD=${geoserverPass} \
                -e STABLE_EXTENSIONS=wps-plugin \
                kartoza/geoserver:2.26.0
              echo ""
              echo "GeoServer starting at: http://localhost:${geoserverPort}/geoserver"
              echo "Credentials: ${geoserverUser} / ${geoserverPass}"
              echo ""
              echo "Wait ~30 seconds for GeoServer to fully start."
              echo "Check status with: geoserver-status"
            }
            export -f geoserver-start

            geoserver-stop() {
              echo "Stopping test GeoServer..."
              docker stop ${geoserverContainer} 2>/dev/null || true
              docker rm ${geoserverContainer} 2>/dev/null || true
              echo "GeoServer stopped."
            }
            export -f geoserver-stop

            geoserver-status() {
              if docker ps --format '{{.Names}}' | grep -q "^${geoserverContainer}$"; then
                echo "GeoServer is running"
                echo ""
                echo "URL:      http://localhost:${geoserverPort}/geoserver"
                echo "REST API: http://localhost:${geoserverPort}/geoserver/rest"
                echo "User:     ${geoserverUser}"
                echo "Password: ${geoserverPass}"
                echo ""
                # Check if GeoServer is ready
                if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${geoserverPort}/geoserver/rest/about/version.json" -u "${geoserverUser}:${geoserverPass}" | grep -q "200"; then
                  echo "Status: READY"
                else
                  echo "Status: STARTING (wait a moment...)"
                fi
              else
                echo "GeoServer is not running"
                echo "Start with: geoserver-start"
              fi
            }
            export -f geoserver-status

            geoserver-logs() {
              docker logs -f ${geoserverContainer}
            }
            export -f geoserver-logs

            geoserver-creds() {
              echo "URL:      $GEOSERVER_URL"
              echo "User:     $GEOSERVER_USER"
              echo "Password: $GEOSERVER_PASS"
            }
            export -f geoserver-creds

            echo ""
            echo "🌍 Kartoza GeoServer Client Development Environment"
            echo ""
            echo "Available commands:"
            echo "  gor  - Run the application"
            echo "  got  - Run tests"
            echo "  gob  - Build binary"
            echo "  gom  - Tidy go modules"
            echo "  gol  - Run linter"
            echo ""
            echo "Test GeoServer:"
            echo "  geoserver-start  - Start Kartoza GeoServer container"
            echo "  geoserver-stop   - Stop and remove container"
            echo "  geoserver-status - Check status and show credentials"
            echo "  geoserver-logs   - Follow container logs"
            echo "  geoserver-creds  - Show connection credentials"
            echo ""
            echo "Documentation:"
            echo "  docs       - Serve docs locally (http://localhost:8000)"
            echo "  docs-build - Build static docs site"
            echo ""
          '';
        };

        apps = {
          default = {
            type = "app";
            program = "${self.packages.${system}.default}/bin/kartoza-geoserver-client";
          };

          setup = {
            type = "app";
            program = toString (pkgs.writeShellScript "setup" ''
              echo "Initializing kartoza-geoserver-client..."
              go mod download
              go mod tidy
              echo "Setup complete!"
            '');
          };
        };
      }
    );
}
