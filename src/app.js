// src/app.js

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import v1Router from "./routes/v1/index.js"; // Import the main v1 router

// Load environment variables
dotenv.config();

// Check for required env var
if (!process.env.DIFY_API_URL) {
  throw new Error("DIFY API URL is required.");
}

const app = express();

// Apply middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// CORS middleware
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization",
  "Access-Control-Max-Age": "86400",
};

app.use((req, res, next) => {
  res.set(corsHeaders);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  console.log('Request Method:', req.method); 
  console.log('Request Path:', req.path);
  next();
});

// Root welcome page
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>DIFY2OPENAI</title>
      </head>
      <body>
        <h1>Dify2OpenAI</h1>
        <p>Congratulations! Your project has been successfully deployed.</p>
      </body>
    </html>
  `);
});

// *** Use the v1 router for all /v1 endpoints ***
app.use('/v1', v1Router);

// Start the server
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${process.env.PORT || 3000}`);
});