# Use the official Node.js 16-alpine image
FROM node:16-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or pnpm-lock.yaml)
# This is done first to leverage Docker cache
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the new 'src' directory with all your app code
COPY src/ ./src/

# Expose the port your app runs on
EXPOSE 3000

# Run the 'start' script from your package.json
# (This works because you updated it to "node src/app.js")
CMD [ "npm", "start" ]