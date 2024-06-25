#!/bin/bash

# Start PostgreSQL service
service postgresql start

# Set PostgreSQL password
su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""

# Check if the ord binary exists in the mounted volume, if not copy it from the image
if [ ! -f /ord-runes/target/release/ord ]; then
    echo "Copying ord binary from image to mounted volume..."
    cp /ord-runes/target/release_initial/ord /ord-runes/target/release/
fi

# Loop until ready.txt is found
while [ ! -f /ready.txt ]; do
    echo "Waiting for ready.txt..."
    sleep 5
done

echo "ready.txt found. Starting the indexer and API."

# Start the indexer in a tmux session
# tmux new-session -d -s index_rune "cd /modules/runes_index && node index_runes.js"

# Start the API in the foreground
# cd /modules/runes_api
exec node index.js
