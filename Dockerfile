FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir "mcp<2"
COPY server ./server
COPY data/sptc.sqlite ./data/sptc.sqlite
ENV SPTC_HTTP=1 SPTC_BIND=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["python", "server/server.py"]
