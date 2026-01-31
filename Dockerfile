FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssh-server \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# Create a non-root user for SSH
RUN useradd -m -s /bin/bash dev \
  && echo 'dev:1234' | chpasswd

# SSH server setup
RUN mkdir -p /var/run/sshd \
  && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
  && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

EXPOSE 22 8000

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
