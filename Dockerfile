# Fundament Dienstverlener als container, bijvoorbeeld voor ZAD.
# Stap 1 bouwt de pagina's (Vite); stap 2 bevat alleen wat nodig is om te draaien.

FROM node:22-alpine AS bouw
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    POORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=bouw /app/dist ./dist
COPY server.ts bijlage.ts beschikking.ts ./
COPY testdata ./testdata
# De app bewaart instellingen.json in /app; die map moet van de gebruiker node zijn.
RUN chown node:node /app
USER node
EXPOSE 8080
CMD ["node", "server.ts"]
