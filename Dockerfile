
# Dockerfile - Node + Python Demucs - cho OnRender
# Fix lỗi 401 và Aborted() do RAM - dùng model nhẹ htdemucs thay vì htdemucs_ft nếu RAM < 1GB

FROM node:18-slim

# Cài Python + ffmpeg + libsndfile (Demucs cần)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Cài Demucs Python - phiên bản nhẹ RAM
# Dùng --break-system-packages vì image node:slim
RUN pip3 install --no-cache-dir --break-system-packages \
    torch==2.1.0 \
    torchaudio==2.1.0 \
    demucs==4.0.1 \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY . .

# Tạo thư mục tạm
RUN mkdir -p /tmp/uploads /tmp/vocal_outputs /tmp/models

ENV PORT=10000
ENV DEMUCS_MODEL=htdemucs
ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "src/index.js"]
