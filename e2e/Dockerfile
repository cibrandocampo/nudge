FROM mcr.microsoft.com/playwright:v1.64.1-jammy
WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci
# Browsers are pre-installed in the image — make sure versions align
RUN npx playwright install chromium
COPY . .
