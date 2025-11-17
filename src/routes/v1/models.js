// src/routes/v1/models.js

import { Router } from "express";
const router = Router();

// Handles GET /v1/models
router.get('/', (req, res) => {
  const models = {
    "object": "list",
    "data": [
      {
        "id": process.env.MODELS_NAME || "dify",
        "object": "model",
        "owned_by": "dify",
        "permission": null,
      }
    ]
  };
  res.json(models);
});

export default router;