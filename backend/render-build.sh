#!/bin/bash
set -e

echo "Installing dependencies..."
npm ci

echo "Building TypeScript..."
npm run build

echo "Generating Prisma client..."
npx prisma generate

echo "Build completed successfully!"