"""
积木零件识别推理服务
加载 .pt (YOLO) 模型，提供 HTTP API，返回格式兼容 Roboflow 工作流输出，
使现有 Node.js 后端的 extractDetectionsFromRoboflowResult 等函数无需改动即可直接使用。

用法：
  # 启动服务
  uvicorn main:app --host 0.0.0.0 --port 8000

  # 通过图片 URL 检测
  curl -X POST http://localhost:8000/detect \
    -H "Content-Type: application/json" \
    -d '{"image_url": "http://example.com/photo.jpg"}'

  # 通过上传文件检测
  curl -X POST http://localhost:8000/detect \
    -F "image=@photo.jpg"
"""

import io
import os
import uuid
import base64
import logging
from typing import Optional

import cv2
import numpy as np
import httpx
from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel
from ultralytics import YOLO

# ── 配置 ──────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("MODEL_PATH", "best.pt")
CONFIDENCE_THRESHOLD = float(os.environ.get("CONFIDENCE_THRESHOLD", "0.25"))
DEVICE = os.environ.get("DEVICE", "cpu")  # "cpu" / "cuda:0"
OUTPUT_IMAGE_ENABLED = os.environ.get("OUTPUT_IMAGE_ENABLED", "true").lower() == "true"
SERVICE_PORT = int(os.environ.get("SERVICE_PORT", "8000"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("inference_service")

# ── 模型加载 ──────────────────────────────────────────────────────
logger.info("Loading YOLO model from %s on device=%s ...", MODEL_PATH, DEVICE)
model = YOLO(MODEL_PATH)
model.to(DEVICE)
logger.info("Model loaded successfully. Class names: %s", model.names)

# ── FastAPI 应用 ──────────────────────────────────────────────────
app = FastAPI(
    title="BlockLab Brick Recognition Service",
    description="Load .pt YOLO model and return Roboflow-compatible detection results",
    version="1.0.0",
)


class DetectByUrlRequest(BaseModel):
    image_url: str
    confidence: Optional[float] = None  # 可覆盖默认阈值


# ── 推理核心 ──────────────────────────────────────────────────────
def run_inference(image_bytes: bytes, confidence: float) -> dict:
    """
    对图片字节执行 YOLO 推理，返回 Roboflow 兼容格式的字典。
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    results = model(img, conf=confidence, verbose=False)[0]

    predictions = []
    if results.boxes is not None:
        for i in range(len(results.boxes)):
            cls_id = int(results.boxes.cls[i])
            conf = float(results.boxes.conf[i])
            # xywh: [x_center, y_center, width, height]
            xc, yc, w, h = results.boxes.xywh[i].tolist()

            predictions.append({
                "class": model.names[cls_id],
                "confidence": round(conf, 6),
                "detection_id": str(uuid.uuid4()),
                "x": round(xc, 2),
                "y": round(yc, 2),
                "width": round(w, 2),
                "height": round(h, 2),
            })

    # ── 可选：生成标注可视化图片（base64） ──
    output_image_value: Optional[str] = None
    if OUTPUT_IMAGE_ENABLED and results.boxes is not None and len(results.boxes) > 0:
        plotted = results.plot()  # numpy array (BGR)
        ret, buf = cv2.imencode(".jpg", plotted, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ret:
            output_image_value = base64.b64encode(buf.tobytes()).decode("utf-8")

    # ── 返回 Roboflow 兼容格式 ──
    # 后端 extractDetectionsFromRoboflowResult 期望：
    #   raw 是数组，raw[i].predictions.predictions → 检测列表
    #   extractOutputImageBase64 在树中找 output_image.value
    return [
        {
            "predictions": {
                "predictions": predictions,
            },
            "output_image": {
                "value": output_image_value,
            },
        }
    ]


def _download_image(url: str) -> bytes:
    """下载远程图片，支持 http/https 和本地文件 file://"""
    if url.startswith("file://"):
        path = url[7:]
        with open(path, "rb") as f:
            return f.read()

    try:
        resp = httpx.get(url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to download image: {e}")


# ── API 端点 ──────────────────────────────────────────────────────

@app.post("/detect")
async def detect_by_url(body: DetectByUrlRequest):
    """根据图片 URL 进行零件检测"""
    confidence = body.confidence if body.confidence is not None else CONFIDENCE_THRESHOLD
    logger.info("detect_by_url: url=%s conf=%s", body.image_url[:80], confidence)
    image_bytes = _download_image(body.image_url)
    return run_inference(image_bytes, confidence)


@app.post("/detect/file")
async def detect_by_file(
    image: UploadFile = File(...),
    confidence: Optional[float] = None,
):
    """直接上传图片文件进行零件检测"""
    conf = confidence if confidence is not None else CONFIDENCE_THRESHOLD
    logger.info("detect_by_file: filename=%s conf=%s", image.filename, conf)
    image_bytes = await image.read()
    return run_inference(image_bytes, conf)


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_PATH, "device": DEVICE}


# ── 直接启动 ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=SERVICE_PORT)
