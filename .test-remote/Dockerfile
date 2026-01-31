FROM ubuntu:22.04

# Install SSH server and dependencies
RUN apt-get update && apt-get install -y \
    openssh-server \
    curl \
    git \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Configure SSH
RUN mkdir /var/run/sshd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
RUN sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Create test user
RUN useradd -m -s /bin/bash testuser
RUN mkdir -p /home/testuser/.ssh && chmod 700 /home/testuser/.ssh

# Will mount authorized_keys at runtime
RUN chown -R testuser:testuser /home/testuser

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
