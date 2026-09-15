FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/data/.huggingface

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .

EXPOSE 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
