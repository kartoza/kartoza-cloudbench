{
  description = "Kartoza CloudBench - Unified management for GeoServer and PostgreSQL/PostGIS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      version = "0.2.0";

      # Overlay that can be imported by other flakes
      overlay = final: prev: {
        # Web frontend built with Nix
        kartoza-cloudbench-web-frontend = final.buildNpmPackage {
          pname = "kartoza-cloudbench-web-frontend";
          inherit version;
          src = "${self}/web";

          npmDepsHash = "sha256-0fvFrSNV1fkuEgXt7KDswkIh3hQHLH/M+aU4jZfgGrk=";

          buildPhase = ''
            npm run build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r ../internal/webserver/static/* $out/ 2>/dev/null || cp -r dist/* $out/
          '';

          meta = with final.lib; {
            description = "Web frontend for Kartoza CloudBench";
            license = licenses.mit;
          };
        };

        # TUI application
        kartoza-cloudbench = final.buildGoModule {
          pname = "kartoza-cloudbench";
          inherit version;
          src = self;

          vendorHash = null;

          # Skip tests that require a running GeoServer
          doCheck = false;

          nativeBuildInputs = [ final.makeWrapper ];

          ldflags = [
            "-s"
            "-w"
            "-X main.version=${version}"
          ];

          # Wrap binary to include gdal and postgis in PATH
          postInstall = ''
            wrapProgram $out/bin/kartoza-cloudbench \
              --prefix PATH : ${
                final.lib.makeBinPath [
                  final.gdal
                  final.postgresqlPackages.postgis
                ]
              }
          '';

          meta = with final.lib; {
            description = "Unified management TUI for GeoServer and PostgreSQL/PostGIS";
            homepage = "https://github.com/kartoza/kartoza-cloudbench";
            license = licenses.mit;
            maintainers = [ ];
            mainProgram = "kartoza-cloudbench";
            platforms = platforms.unix ++ platforms.windows;
          };
        };

        # Web server with embedded frontend
        kartoza-cloudbench-web = final.buildGoModule {
          pname = "kartoza-cloudbench-web";
          inherit version;
          src = self;

          vendorHash = null;

          # Skip tests that require a running GeoServer
          doCheck = false;

          nativeBuildInputs = [ final.makeWrapper ];

          # Copy the built frontend before Go build
          preBuild = ''
            mkdir -p internal/webserver/static
            cp -r ${final.kartoza-cloudbench-web-frontend}/* internal/webserver/static/ || true
          '';

          subPackages = [ "cmd/web" ];

          ldflags = [
            "-s"
            "-w"
            "-X main.version=${version}"
          ];

          # Wrap binary to include gdal and postgis in PATH
          postInstall = ''
            wrapProgram $out/bin/web \
              --prefix PATH : ${
                final.lib.makeBinPath [
                  final.gdal
                  final.postgresqlPackages.postgis
                ]
              }
          '';

          meta = with final.lib; {
            description = "Web interface for Kartoza CloudBench";
            homepage = "https://github.com/kartoza/kartoza-cloudbench";
            license = licenses.mit;
            maintainers = [ ];
            mainProgram = "web";
            platforms = platforms.unix ++ platforms.windows;
          };
        };
      };
    in
    {
      # Export overlay for use in other flakes
      overlays.default = overlay;
      overlays.kartoza-cloudbench = overlay;

    }
    // flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ overlay ];
        };

        # MkDocs with Material theme for documentation
        mkdocsEnv = pkgs.python3.withPackages (
          ps: with ps; [
            mkdocs
            mkdocs-material
            mkdocs-minify-plugin
            pygments
            pymdown-extensions
          ]
        );

        # Test GeoServer configuration
        geoserverContainer = "kartoza-geoserver-test";
        geoserverPort = "8600";
        geoserverUser = "admin";
        geoserverPass = "geoserver";

        # Test PostGIS configuration
        postgisContainer = "kartoza-postgis-test";
        postgisPort = "5433";
        postgisUser = "docker";
        postgisPass = "docker";
        postgisDb = "gis";

        # Test MinIO (S3-compatible) configuration
        minioContainer = "kartoza-minio-test";
        minioPort = "9000";
        minioConsolePort = "9001";
        minioRootUser = "minioadmin";
        minioRootPassword = "minioadmin";
        minioDefaultBucket = "geospatial-data";

      in
      {
        packages = {
          default = pkgs.kartoza-cloudbench;
          kartoza-cloudbench = pkgs.kartoza-cloudbench;
          kartoza-cloudbench-web = pkgs.kartoza-cloudbench-web;
          kartoza-cloudbench-web-frontend = pkgs.kartoza-cloudbench-web-frontend;
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

            # Node.js for web frontend (from Nix)
            nodejs_22
            nodePackages.typescript
            nodePackages.typescript-language-server

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

            # GIS tools for data import and cloud-native conversion
            gdal # Provides ogr2ogr for vector data import and COG conversion
            pdal # Provides COPC (Cloud Optimized Point Cloud) conversion
            postgresqlPackages.postgis # Provides raster2pgsql for raster data import

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

            # Test PostGIS configuration
            export POSTGIS_CONTAINER="${postgisContainer}"
            export POSTGIS_PORT="${postgisPort}"
            export POSTGIS_USER="${postgisUser}"
            export POSTGIS_PASS="${postgisPass}"
            export POSTGIS_DB="${postgisDb}"

            # Test MinIO (S3-compatible) configuration
            export MINIO_CONTAINER="${minioContainer}"
            export MINIO_PORT="${minioPort}"
            export MINIO_CONSOLE_PORT="${minioConsolePort}"
            export MINIO_ROOT_USER="${minioRootUser}"
            export MINIO_ROOT_PASSWORD="${minioRootPassword}"
            export MINIO_DEFAULT_BUCKET="${minioDefaultBucket}"
            export MINIO_ENDPOINT="http://localhost:${minioPort}"

            # Helpful aliases
            alias gor='go run .'
            alias got='go test -v ./...'
            alias gob='go build -o bin/kartoza-cloudbench .'
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

            # PostGIS test environment commands
            postgis-start() {
              echo "Starting test PostGIS on port ${postgisPort}..."
              docker run -d \
                --name ${postgisContainer} \
                -p ${postgisPort}:5432 \
                -e POSTGRES_USER=${postgisUser} \
                -e POSTGRES_PASS=${postgisPass} \
                -e POSTGRES_DBNAME=${postgisDb} \
                -e ALLOW_IP_RANGE=0.0.0.0/0 \
                -v kartoza-postgis-data:/var/lib/postgresql \
                kartoza/postgis:16-3.4
              echo ""
              echo "PostGIS starting at: localhost:${postgisPort}"
              echo "Database: ${postgisDb}"
              echo "Credentials: ${postgisUser} / ${postgisPass}"
              echo ""
              echo "Wait ~10 seconds for PostgreSQL to fully start."
              echo "Check status with: postgis-status"
              echo ""
              echo "Connection string:"
              echo "  postgresql://${postgisUser}:${postgisPass}@localhost:${postgisPort}/${postgisDb}"
              echo ""
              echo "pg_service.conf entry:"
              echo "  [cloudbench_test]"
              echo "  host=localhost"
              echo "  port=${postgisPort}"
              echo "  dbname=${postgisDb}"
              echo "  user=${postgisUser}"
              echo "  password=${postgisPass}"
            }
            export -f postgis-start

            postgis-stop() {
              echo "Stopping test PostGIS..."
              docker stop ${postgisContainer} 2>/dev/null || true
              docker rm ${postgisContainer} 2>/dev/null || true
              echo "PostGIS stopped."
              echo "Note: Data volume 'kartoza-postgis-data' preserved. Use 'postgis-clean' to remove it."
            }
            export -f postgis-stop

            postgis-clean() {
              echo "Removing PostGIS data volume..."
              docker volume rm kartoza-postgis-data 2>/dev/null || true
              echo "Data volume removed."
            }
            export -f postgis-clean

            postgis-status() {
              if docker ps --format '{{.Names}}' | grep -q "^${postgisContainer}$"; then
                echo "PostGIS is running"
                echo ""
                echo "Host:     localhost"
                echo "Port:     ${postgisPort}"
                echo "Database: ${postgisDb}"
                echo "User:     ${postgisUser}"
                echo "Password: ${postgisPass}"
                echo ""
                # Check if PostgreSQL is ready using psql test via TCP
                if docker exec -e PGPASSWORD=${postgisPass} ${postgisContainer} psql -h localhost -U ${postgisUser} -d ${postgisDb} -c "SELECT 1;" >/dev/null 2>&1; then
                  echo "Status: READY"
                  # Show PostGIS version
                  echo ""
                  docker exec -e PGPASSWORD=${postgisPass} ${postgisContainer} psql -h localhost -U ${postgisUser} -d ${postgisDb} -c "SELECT PostGIS_Version();" 2>/dev/null
                else
                  echo "Status: STARTING (wait a moment...)"
                fi
              else
                echo "PostGIS is not running"
                echo "Start with: postgis-start"
              fi
            }
            export -f postgis-status

            postgis-logs() {
              docker logs -f ${postgisContainer}
            }
            export -f postgis-logs

            postgis-creds() {
              echo "Host:     localhost"
              echo "Port:     $POSTGIS_PORT"
              echo "Database: $POSTGIS_DB"
              echo "User:     $POSTGIS_USER"
              echo "Password: $POSTGIS_PASS"
              echo ""
              echo "Connection string:"
              echo "  postgresql://$POSTGIS_USER:$POSTGIS_PASS@localhost:$POSTGIS_PORT/$POSTGIS_DB"
            }
            export -f postgis-creds

            postgis-psql() {
              docker exec -e PGPASSWORD=${postgisPass} -it ${postgisContainer} psql -h localhost -U ${postgisUser} -d ${postgisDb}
            }
            export -f postgis-psql

            postgis-service() {
              echo "Add this to ~/.pg_service.conf:"
              echo ""
              echo "[cloudbench_test]"
              echo "host=localhost"
              echo "port=${postgisPort}"
              echo "dbname=${postgisDb}"
              echo "user=${postgisUser}"
              echo "password=${postgisPass}"
            }
            export -f postgis-service

            # MinIO (S3-compatible) test environment commands
            minio-start() {
              echo "Starting test MinIO on ports ${minioPort} (S3 API) and ${minioConsolePort} (Console)..."
              docker run -d \
                --name ${minioContainer} \
                -p ${minioPort}:9000 \
                -p ${minioConsolePort}:9001 \
                -e MINIO_ROOT_USER=${minioRootUser} \
                -e MINIO_ROOT_PASSWORD=${minioRootPassword} \
                -v kartoza-minio-data:/data \
                minio/minio:latest server /data --console-address ":9001"
              echo ""
              echo "MinIO starting..."
              echo "S3 API:  http://localhost:${minioPort}"
              echo "Console: http://localhost:${minioConsolePort}"
              echo "Credentials: ${minioRootUser} / ${minioRootPassword}"
              echo ""
              echo "Wait ~5 seconds for MinIO to start."
              echo "Check status with: minio-status"
              echo ""
              echo "Creating default bucket '${minioDefaultBucket}'..."
              sleep 3
              docker run --rm --network host \
                -e MC_HOST_local=http://${minioRootUser}:${minioRootPassword}@localhost:${minioPort} \
                minio/mc mb --ignore-existing local/${minioDefaultBucket} 2>/dev/null || true
              echo "Default bucket created."
            }
            export -f minio-start

            minio-stop() {
              echo "Stopping test MinIO..."
              docker stop ${minioContainer} 2>/dev/null || true
              docker rm ${minioContainer} 2>/dev/null || true
              echo "MinIO stopped."
              echo "Note: Data volume 'kartoza-minio-data' preserved. Use 'minio-clean' to remove it."
            }
            export -f minio-stop

            minio-clean() {
              echo "Removing MinIO data volume..."
              docker volume rm kartoza-minio-data 2>/dev/null || true
              echo "Data volume removed."
            }
            export -f minio-clean

            minio-status() {
              if docker ps --format '{{.Names}}' | grep -q "^${minioContainer}$"; then
                echo "MinIO is running"
                echo ""
                echo "S3 API:   http://localhost:${minioPort}"
                echo "Console:  http://localhost:${minioConsolePort}"
                echo "User:     ${minioRootUser}"
                echo "Password: ${minioRootPassword}"
                echo ""
                # Check if MinIO is ready by hitting health endpoint
                if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${minioPort}/minio/health/live" | grep -q "200"; then
                  echo "Status: READY"
                  echo ""
                  # List buckets
                  echo "Buckets:"
                  docker run --rm --network host \
                    -e MC_HOST_local=http://${minioRootUser}:${minioRootPassword}@localhost:${minioPort} \
                    minio/mc ls local/ 2>/dev/null || echo "  (none or error listing)"
                else
                  echo "Status: STARTING (wait a moment...)"
                fi
              else
                echo "MinIO is not running"
                echo "Start with: minio-start"
              fi
            }
            export -f minio-status

            minio-logs() {
              docker logs -f ${minioContainer}
            }
            export -f minio-logs

            minio-creds() {
              echo "Endpoint: http://localhost:$MINIO_PORT"
              echo "Console:  http://localhost:$MINIO_CONSOLE_PORT"
              echo "User:     $MINIO_ROOT_USER"
              echo "Password: $MINIO_ROOT_PASSWORD"
              echo ""
              echo "Default bucket: $MINIO_DEFAULT_BUCKET"
              echo ""
              echo "For AWS CLI:"
              echo "  export AWS_ACCESS_KEY_ID=$MINIO_ROOT_USER"
              echo "  export AWS_SECRET_ACCESS_KEY=$MINIO_ROOT_PASSWORD"
              echo "  aws --endpoint-url=http://localhost:$MINIO_PORT s3 ls"
            }
            export -f minio-creds

            minio-console() {
              echo "Opening MinIO Console in browser..."
              xdg-open "http://localhost:${minioConsolePort}" 2>/dev/null || \
              open "http://localhost:${minioConsolePort}" 2>/dev/null || \
              echo "Open http://localhost:${minioConsolePort} in your browser"
            }
            export -f minio-console

            minio-mc() {
              # Run MinIO client command with local alias configured
              docker run --rm -it --network host \
                -e MC_HOST_local=http://${minioRootUser}:${minioRootPassword}@localhost:${minioPort} \
                minio/mc "$@"
            }
            export -f minio-mc

            # Web development commands
            web-dev() {
              echo "Starting web development servers..."
              echo "Frontend: cd web && npm run dev"
              echo "Backend:  go run ./cmd/web"
            }
            export -f web-dev

            web-build() {
              echo "Building web frontend with Nix..."
              nix build .#kartoza-cloudbench-web-frontend -o result-frontend
              echo "Copying to internal/webserver/static..."
              rm -rf internal/webserver/static/*
              cp -r result-frontend/* internal/webserver/static/
              rm result-frontend
              echo "Frontend built successfully!"
            }
            export -f web-build

            echo ""
            echo "🌍 Kartoza CloudBench Development Environment"
            echo ""
            echo "Available commands:"
            echo "  gor  - Run the application"
            echo "  got  - Run tests"
            echo "  gob  - Build binary"
            echo "  gom  - Tidy go modules"
            echo "  gol  - Run linter"
            echo ""
            echo "Web Interface:"
            echo "  web-dev    - Show dev server instructions"
            echo "  web-build  - Build frontend with Nix"
            echo "  nix build .#kartoza-cloudbench-web - Build complete web server"
            echo ""
            echo "Test GeoServer:"
            echo "  geoserver-start  - Start Kartoza GeoServer container"
            echo "  geoserver-stop   - Stop and remove container"
            echo "  geoserver-status - Check status and show credentials"
            echo "  geoserver-logs   - Follow container logs"
            echo "  geoserver-creds  - Show connection credentials"
            echo ""
            echo "Test PostGIS:"
            echo "  postgis-start    - Start Kartoza PostGIS container"
            echo "  postgis-stop     - Stop and remove container (keeps data)"
            echo "  postgis-clean    - Remove data volume"
            echo "  postgis-status   - Check status and show credentials"
            echo "  postgis-logs     - Follow container logs"
            echo "  postgis-creds    - Show connection credentials"
            echo "  postgis-psql     - Open psql shell"
            echo "  postgis-service  - Show pg_service.conf entry"
            echo ""
            echo "Test MinIO (S3):"
            echo "  minio-start      - Start MinIO S3-compatible storage"
            echo "  minio-stop       - Stop and remove container (keeps data)"
            echo "  minio-clean      - Remove data volume"
            echo "  minio-status     - Check status and list buckets"
            echo "  minio-logs       - Follow container logs"
            echo "  minio-creds      - Show connection credentials"
            echo "  minio-console    - Open MinIO web console"
            echo "  minio-mc         - Run MinIO client (mc) commands"
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
            program = "${self.packages.${system}.default}/bin/kartoza-cloudbench";
          };

          web = {
            type = "app";
            program = "${self.packages.${system}.kartoza-cloudbench-web}/bin/web";
          };

          setup = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "setup" ''
                echo "Initializing Kartoza CloudBench..."
                go mod download
                go mod tidy
                echo "Setup complete!"
              ''
            );
          };
        };
      }
    );
}
