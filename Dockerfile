FROM node:22-slim

WORKDIR /app

# Cài Python + ffmpeg + libsndfile - FIX NumPy 2.x lỗi torch
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

# FIX QUAN TRỌNG: Pin numpy<2 trước khi cài torch - torch 2.1.0 không chạy với numpy 2.4
RUN pip3 install --no-cache-dir --break-system-packages \
    "numpy<2" \
    "scipy<1.14" \
    && pip3 install --no-cache-dir --break-system-packages \
    torch==2.1.0 \
    torchaudio==2.1.0 \
    demucs==4.0.1 \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY . .
RUN mkdir -p /tmp/uploads /tmp/vocal_outputs /tmp/models

ENV NODE_ENV=production
ENV PORT=8080
ENV DEMUCS_MODEL=htdemucs
# Fix NumPy warning
ENV PYTHONWARNINGS="ignore"

EXPOSE 8080
CMD ["node", "src/index.js"]
