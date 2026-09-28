# Build stage: needs devDependencies (vite, esbuild) to compile frontend + backend.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# VITE_API_BASE_URL is baked into the frontend bundle at build time. It is left empty
# here so the image serves its own API from the same origin; Firebase Hosting builds
# set it separately to point at this service.
RUN npm run build

# Runtime stage: production dependencies only — no vite, no esbuild.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Cloud Run sets PORT (8080 by default) and the server reads it from the environment.
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
