// src/routes/v1/textCompletions.js
// This handles the legacy /v1/completions endpoint

import { Router } from "express";
import { makeDifyRequest } from "../../services/difyApiClient.js";
import { generateId } from "../../utils/idGenerator.js";

const router = Router();

// Get other env variables
const inputVariable = process.env.INPUT_VARIABLE || '';
const outputVariable = process.env.OUTPUT_VARIABLE || '';

// Handles POST /v1/completions
router.post("/", async (req, res) => {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader) {
    return res.status(401).json({
      code: 401,
      errmsg: "Unauthorized.",
    });
  } else {
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        code: 401,
        errmsg: "Unauthorized.",
      });
    }
  }
  try {
    const data = req.body;

    // "Edit" (completions) 模式係用 data.prompt 嚟傳送文字
    // 佢唔支援圖片，所以邏輯簡單好多
    const queryString = data.prompt;

    const stream = data.stream !== undefined ? data.stream : false;
    let requestBody;

    // 我哋照樣用 .env 嘅 INPUT_VARIABLE
    if (inputVariable) {
      requestBody = {
        inputs: { [inputVariable]: queryString },
        response_mode: stream ? "streaming" : "blocking",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    } else {
      requestBody = {
        "inputs": {},
        query: queryString,
        response_mode: stream ? "streaming" : "blocking",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    }
    // "Edit" 模式唔會傳送圖片，所以唔需要 imageList 

    // *** MODIFICATION: Call the service instead of fetch ***
    const resp = await makeDifyRequest(requestBody, authHeader.split(" ")[1]);
    // *** END MODIFICATION ***

    let isResponseEnded = false;

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      const stream = resp.body;
      let buffer = "";
      let isFirstChunk = true;

      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
          let line = lines[i].trim();

          if (!line.startsWith("data:")) continue;
          line = line.slice(5).trim();
          let chunkObj;
          try {
            if (line.startsWith("{")) {
              chunkObj = JSON.parse(line);
            } else {
              continue;
            }
          } catch (error) {
            console.error("Error parsing chunk:", error);
            continue;
          }

          if (chunkObj.event === "message" || chunkObj.event === "agent_message" || chunkObj.event === "text_chunk") {
            let chunkContent;

            if (chunkObj.event === "text_chunk") {
              chunkContent = chunkObj.data.text;
            } else if (outputVariable && chunkObj.answer && typeof chunkObj.answer === 'object') {
              chunkContent = chunkObj.answer[outputVariable];
            } else {
              chunkContent = chunkObj.answer;
            }

            if (isFirstChunk) {
              if (chunkContent) {
                chunkContent = chunkContent.trimStart();
                isFirstChunk = false;
              }
            }

            if (chunkContent && chunkContent !== "") {
              const chunkId = `chatcmpl-${Date.now()}`;
              const chunkCreated = chunkObj.created_at;

              if (!isResponseEnded) {
                // *** 關鍵修改：completions 嘅 stream 格式係 "text"，唔係 "delta.content"
                res.write(
                  "data: " +
                    JSON.stringify({
                      id: chunkId,
                      object: "text_completion.chunk", // (可以改, 但 client 通常唔 care)
                      created: chunkCreated,
                      model: data.model,
                      choices: [
                        {
                          index: 0,
                          text: chunkContent, // <-- 呢度唔同
                          finish_reason: null,
                        },
                      ],
                    }) +
                    "\n\n"
                );
              }
            }
          } else if (chunkObj.event === "workflow_finished" || chunkObj.event === "message_end") {
            const chunkId = `chatcmpl-${Date.now()}`;
            const chunkCreated = chunkObj.created_at;
            if (!isResponseEnded) {
              res.write(
                "data: " +
                  JSON.stringify({
                    id: chunkId,
                    object: "text_completion.chunk",
                    created: chunkCreated,
                    model: data.model,
                    choices: [
                      {
                        index: 0,
                        text: "", // <-- 呢度唔同
                        finish_reason: "stop",
                      },
                    ],
                  }) +
                  "\n\n"
              );
            }
            if (!isResponseEnded) {
              res.write("data: [DONE]\n\n");
            }

            res.end();
            isResponseEnded = true;
          } else if (chunkObj.event === "agent_thought") {
          } else if (chunkObj.event === "ping") {
          } else if (chunkObj.event === "error") {
            // (Error handling 照抄)
            console.error(`Error: ${chunkObj.code}, ${chunkObj.message}`);
            res
              .status(500)
              .write(
                `data: ${JSON.stringify({ error: chunkObj.message })}\n\n`
              );
            if (!isResponseEnded) {
              res.write("data: [DONE]\n\n");
            }
            res.end();
            isResponseEnded = true;
          }
        }
        buffer = lines[lines.length - 1];
      });
    } else {
      // (非 Stream 模式)
      let result = "";
      let usageData = "";
      let hasError = false;
      let messageEnded = false;
      let buffer = "";
      let skipWorkflowFinished = false;

      const stream = resp.body;
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
            // (呢度嘅 Dify 邏輯完全一樣)
            const line = lines[i].trim();
            if (line === "") continue;
            let chunkObj;
            try {
              const cleanedLine = line.replace(/^data: /, "").trim();
              if (cleanedLine.startsWith("{") && cleanedLine.endsWith("}")) {
                chunkObj = JSON.parse(cleanedLine);
              } else {
                continue;
              }
            } catch (error) {
              console.error("Error parsing JSON:", error);
              continue;
            }

            if (
              chunkObj.event === "message" ||
              chunkObj.event === "agent_message"
            ) {
              result += chunkObj.answer;
              skipWorkflowFinished = true;
            } else if (chunkObj.event === "message_end") {
              messageEnded = true;
              usageData = {
                prompt_tokens: chunkObj.metadata.usage.prompt_tokens || 100,
                completion_tokens:
                  chunkObj.metadata.usage.completion_tokens || 10,
                total_tokens: chunkObj.metadata.usage.total_tokens || 110,
              };
            } else if (chunkObj.event === "workflow_finished" && !skipWorkflowFinished) {
              messageEnded = true;
              const outputs = chunkObj.data.outputs;
              if (outputVariable) {
                result = outputs[outputVariable];
              } else {
                result = outputs;
              }
              result = String(result);
              usageData = {
                prompt_tokens: chunkObj.metadata?.usage?.prompt_tokens || 100,
                completion_tokens: chunkObj.metadata?.usage?.completion_tokens || 10,
                total_tokens: chunkObj.data.total_tokens || 110,
              };
            } else if (chunkObj.event === "error") {
              console.error(`Error: ${chunkObj.code}, ${chunkObj.message}`);
              hasError = true;
              break;
            } 
        }
        buffer = lines[lines.length - 1];
      });

      stream.on("end", () => {
        if (hasError) {
          res
            .status(500)
            .json({ error: "An error occurred while processing the request." });
        } else if (messageEnded) {
          // *** 關鍵修改：completions 嘅 response 格式係 "text"，唔係 "message.content"
          const formattedResponse = {
            id: `cmpl-${generateId()}`, // (ID 格式改一改)
            object: "text_completion", // (Object 唔同)
            created: Math.floor(Date.now() / 1000),
            model: data.model,
            choices: [
              {
                index: 0,
                text: result.trim(), // <-- 呢度唔同
                logprobs: null,
                finish_reason: "stop",
              },
            ],
            usage: usageData,
          };
          const jsonResponse = JSON.stringify(formattedResponse, null, 2);
          res.set("Content-Type", "application/json");
          res.send(jsonResponse);
        } else {
          res.status(500).json({ error: "Unexpected end of stream." });
        }
      });
    }
  } catch (error) {
    console.error("Error:", error);
  }
});

export default router;