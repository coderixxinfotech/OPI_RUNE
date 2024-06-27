# Use the official Node.js image from the Docker Hub
FROM node:14

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of your application files
COPY . .

# Expose the port your application will run on
EXPOSE 8080

# Command to run the application
CMD ["node", "index.js"]
