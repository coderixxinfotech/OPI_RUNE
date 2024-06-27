#!/bin/bash

# Start PostgreSQL service
# service postgresql start

# # Set PostgreSQL password
# su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""

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
