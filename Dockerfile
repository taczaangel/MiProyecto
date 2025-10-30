FROM node:18-bullseye

# Instalar dependencias necesarias para Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    libgbm1 \
    libxshmfence1 \
    libpango-1.0-0 \
    libcairo2 \
    libglib2.0-0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Establecer directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer puerto
EXPOSE 8080

# Comando de inicio
CMD ["npm", "start"]
```

**Guarda el archivo.**

---

## 📋 PASO 3: Crear archivo .dockerignore

Crea otro archivo llamado:
```
.dockerignore
```

Y pega esto dentro:
```
node_modules
.wwebjs_auth
.wwebjs_cache
.git
.gitignore
*.log