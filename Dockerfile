# ---- Build ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Run (Playwright Chromium) ----
FROM node:20-bookworm-slim
RUN npx playwright install-deps chromium && npx playwright install chromium

ENV HEADLESS=true

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 2003
ENV PORT=2003
CMD ["node", "dist/index.js"]
