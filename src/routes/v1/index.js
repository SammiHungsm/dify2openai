// src/routes/v1/index.js

import { Router } from "express";
import modelsRouter from "./models.js";
import chatCompletionsRouter from "./completions.js";
import textCompletionsRouter from "./textCompletions.js"; // The one I added

const router = Router();

// /v1/models
router.use('/models', modelsRouter);

// /v1/chat/completions
router.use('/chat/completions', chatCompletionsRouter);

// /v1/completions
router.use('/completions', textCompletionsRouter);

export default router;