FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    openssh-server \
    git \
    curl \
    ripgrep \
    sudo \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Setup SSH
RUN mkdir /var/run/sshd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config
RUN sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config
RUN sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Create dev user
RUN useradd -m -s /bin/bash -G sudo dev
RUN echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# SSH directory for dev user
RUN mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh
COPY authorized_keys /home/dev/.ssh/authorized_keys
RUN chmod 600 /home/dev/.ssh/authorized_keys
RUN chown -R dev:dev /home/dev/.ssh

# Create a sample project directory
RUN mkdir -p /home/dev/project && chown dev:dev /home/dev/project

# Expose SSH port
EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
