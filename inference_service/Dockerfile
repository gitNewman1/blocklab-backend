# ── BlockLab 推理服务 Dockerfile ─────────────────────────────────
# 构建：docker build -t blocklab-inference ./inference_service
# 运行：docker run -d --gpus all -p 8000:8000 \
#         -v /path/to/best.pt:/app/best.pt \
#         -e MODEL_PATH=/app/best.pt \
#         -e DEVICE=cuda:0 \
#         blocklab-inference

FROM ultralytics/ultralytics:latest

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
