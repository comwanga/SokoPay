FROM rust:1.85-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first and build a throw-away binary to cache all dependencies.
# This layer is only invalidated when Cargo.toml or Cargo.lock changes,
# not on every source edit — saves 2-4 min per build.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && \
    cargo build --release && \
    rm -rf src target/release/sokopay target/release/deps/sokopay*

# Now copy real source — only your code is recompiled, not all dependencies
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user so a compromised process can't write outside /app
RUN useradd -r -s /bin/false -u 1001 sokopay

WORKDIR /app
COPY --from=builder /app/target/release/sokopay .
COPY migrations ./migrations

RUN mkdir -p /app/uploads && chown sokopay:sokopay /app/uploads

USER sokopay

EXPOSE 3001
CMD ["./sokopay"]
