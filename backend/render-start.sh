#!/bin/bash
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting API server..."
npm start