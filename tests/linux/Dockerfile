FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git pkg-config unzip acl jq minisign \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    libmpv-dev libgl1-mesa-dri libgl-dev \
    ffmpeg xvfb xauth dbus-x11 openbox xdotool webkit2gtk-driver fonts-dejavu-core haskell-gtk-sni-tray-utils \
    && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -fsSL https://bun.sh/install -o /tmp/install-bun.sh \
    && bash /tmp/install-bun.sh bun-v1.4.2 \
    && cp /root/.bun/bin/bun /usr/local/bin/bun \
    && rm /tmp/install-bun.sh
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal --default-toolchain stable \
    && rm /tmp/rustup.sh
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install tauri-driver --locked
RUN case "$(uname -m)" in aarch64) asset=yt-dlp_linux_aarch64 ;; x86_64) asset=yt-dlp_linux ;; esac \
    && curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/$asset" -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio pulseaudio-utils x11-utils \
    && rm -rf /var/lib/apt/lists/*
RUN case "$(uname -m)" in aarch64) arch=aarch64 ;; x86_64) arch=x86_64 ;; esac \
    && curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/denoland/deno/releases/download/v2.9.6/deno-${arch}-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip

ENV CARGO_TARGET_DIR=/cache/target \
    CARGO_BUILD_JOBS=4 \
    LIBGL_ALWAYS_SOFTWARE=1 \
    WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
    GDK_BACKEND=x11 \
    COUCH_BASIC_RENDERING=1 \
    COUCH_PORT=4100
WORKDIR /work
CMD ["bash", "/source/tests/linux/run.sh"]
