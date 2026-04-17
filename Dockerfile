FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package.json .
RUN npm install

# Install Playwright browsers
RUN npx playwright install chromium

COPY server.js .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
