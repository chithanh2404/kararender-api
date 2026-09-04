FROM node:22-slim

WORKDIR /app

# Cài Python + ffmpeg + libsndfile (Demucs cần) - FIX lỗi 401 và Aborted() do RAM client
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

# Cài Demucs + torch CPU - nhẹ RAM, giữ stereo 100%
RUN pip3 install --no-cache-dir --break-system-packages \
    torch==2.1.0 \
    torchaudio==2.1.0 \
    demucs==4.0.1 \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY . .
RUN mkdir -p /tmp/uploads /tmp/vocal_outputs /tmp/models

ENV NODE_ENV=production
ENV PORT=8080
ENV DEMUCS_MODEL=htdemucs

EXPOSE 8080
CMD ["node", "src/index.js"]
