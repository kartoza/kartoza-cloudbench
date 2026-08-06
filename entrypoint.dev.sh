#!/bin/sh

set -e

cd /home/web/kartoza-cloudbench/web
npm install

export VITE_BASE_URL="${VITE_BASE_URL:-}"
export VITE_API_BASE="${VITE_API_BASE:-}"
export VITE_CREATE_GEOSERVER_URL="${VITE_CREATE_GEOSERVER_URL:-}"
export VITE_CREATE_GEONODE_URL="${VITE_CREATE_GEONODE_URL:-}"
export VITE_CREATE_POSTGIS_URL="${VITE_CREATE_POSTGIS_URL:-}"

exec npm run dev -- --host 0.0.0.0