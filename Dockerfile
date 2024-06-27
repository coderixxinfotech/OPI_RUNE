# Use an official Ubuntu as a parent image
FROM ubuntu:22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    ca-certificates curl gnupg \
    build-essential \
    python3-pip \
    git \
    libssl-dev \
    pkg-config \
    wget \
    tini \
    tmux && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Cargo & Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Set the working directory
WORKDIR /

# Copy the entire project into the container
COPY . /

# Build ord
# RUN cd ord-runes && /root/.cargo/bin/cargo build --release

# Install Node.js modules
RUN npm install

# Install Python libraries
RUN python3 -m pip install python-dotenv psycopg2-binary json5 stdiomask requests boto3 tqdm

# Make the entrypoint script executable
RUN chmod +x entrypoint.sh


# Set the entrypoint
ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
