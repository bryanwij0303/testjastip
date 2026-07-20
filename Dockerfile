# Titiport Jastip — Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py rag.py ./
COPY docs ./docs

# data (orders.db, rag.db, policy.md) persistent via volume (/app/data)
ENV DB_PATH=/app/data/orders.db
ENV RAG_DB_PATH=/app/data/rag.db
ENV WAHA_URL=http://host.docker.internal:3001
ENV WAHA_KEY=wa-secret-key
RUN mkdir -p /app/data

EXPOSE 5000

CMD ["python", "app.py"]
