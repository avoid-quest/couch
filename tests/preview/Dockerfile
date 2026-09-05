FROM couch-linux-test:ubuntu24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    novnc websockify x11vnc \
    && rm -rf /var/lib/apt/lists/*

CMD ["bash", "/source/tests/preview/run.sh"]
