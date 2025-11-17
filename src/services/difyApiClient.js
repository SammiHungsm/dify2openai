// src/services/difyApiClient.js

import fetch from "node-fetch";

// Read environment variables once
const difyApiUrl = process.env.DIFY_API_URL;
const botType = process.env.BOT_TYPE || 'Chat';

if (!difyApiUrl) {
  throw new Error("DIFY API URL is required in .env");
}

/**
 * Determines the Dify API path based on the BOT_TYPE.
 * @returns {string} The API path (e.g., '/chat-messages').
 */
function getDifyApiPath() {
  switch (botType) {
    case 'Chat':
      return '/chat-messages';
    case 'Completion':
      return '/completion-messages';
    case 'Workflow':
      return '/workflows/run';
    default:
      throw new Error('Invalid bot type in the environment variable.');
  }
}

const fullApiUrl = difyApiUrl + getDifyApiPath();

/**
 * Makes the actual fetch request to the Dify API.
 * The route handler is responsible for building the requestBody and
 * processing the streamed response.
 * @param {object} requestBody - The body to send to Dify.
 * @param {string} token - The Dify API token.
 * @returns {Promise<Response>} The node-fetch response object.
 */
export const makeDifyRequest = async (requestBody, token) => {
  return await fetch(fullApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });
};