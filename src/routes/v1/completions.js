// src/routes/v1/completions.js

import { Router } from "express";
import { makeDifyRequest } from "../../services/difyApiClient.js";
import { generateId } from "../../utils/idGenerator.js";

const router = Router();

// Get other env variables
const botType = process.env.BOT_TYPE || 'Chat';
const inputVariable = process.env.INPUT_VARIABLE || '';
const outputVariable = process.env.OUTPUT_VARIABLE || '';

// Handles POST /v1/chat/completions
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
    const messages = data.messages;
    
    // --- 圖片處理開始 ---
    const lastMessage = messages[messages.length - 1];
    let queryString = "";
    let imageList = [];

    if (Array.isArray(lastMessage.content)) {
      // 呢個係 OpenAI 嘅 Vision (圖片) request
      for (const part of lastMessage.content) {
        if (part.type === 'text') {
          queryString = part.text; // 提取文字部分
        } else if (part.type === 'image_url' && part.image_url.url) {
          const imageUrl = part.image_url.url;
          // 檢查係咪 Base64 圖片
          if (imageUrl.startsWith('data:image')) {
            const base64Data = imageUrl.split(',')[1]; // 拎 Base64 數據
            if (base64Data) {
              imageList.push({
                type: 'image',
                transfer_method: 'base64',
                upload_file: base64Data, // 傳俾 Dify 嘅 Base64
              });
            }
          }
          // 注意: 呢度暫時忽略咗 http/https 嘅圖片 URL
        }
      }
    } else if (typeof lastMessage.content === 'string') {
      // 呢個係純文字 request
      queryString = lastMessage.content;
    }
    // --- 圖片處理結束 ---

    // 處理 Chat Bot 嘅歷史訊息 (呢部分仍然只支援文字歷史)
    if (botType === 'Chat') {
      if (typeof lastMessage.content === 'string') {
        // 如果最後一條係純文字，就正常組合歷史
        queryString = `here is our talk history:\n'''\n${messages
          .slice(0, -1) 
          .map((message) => `${message.role}: ${message.content}`) // 歷史只支援文字
          .join('\n')}\n'''\n\nhere is my question:\n${lastMessage.content}`;
      }
      // 如果最後一條係圖片，queryString 就會係上面提取嘅文字部分
      // (為咗簡化，我哋犧牲咗 Chat 模式下傳圖片時嘅文字歷史)
    }
    // 'Completion' 或 'Workflow' 模式會直接用上面提取嘅 queryString

    const stream = data.stream !== undefined ? data.stream : false;
    let requestBody;
    
    if (inputVariable) {
      requestBody = {
        inputs: { [inputVariable]: queryString },
        response_mode: stream ? "streaming" : "blocking", // 根據 stream 參數調整
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    } else {
      requestBody = {
        "inputs": {},
        query: queryString,
        response_mode: stream ? "streaming" : "blocking", // 根據 stream 參數調整
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    }

    // --- 圖片處理開始 ---
    // 將提取到嘅圖片加入 requestBody
    if (imageList.length > 0) {
      requestBody.files = imageList;
    }
    // --- 圖片處理結束 ---

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
            
            // --- 應對 Dify Workflow 嘅唔同 output 格式 ---
            if (chunkObj.event === "text_chunk") {
              chunkContent = chunkObj.data.text; // Workflow 嘅 text_chunk
            } else if (outputVariable && chunkObj.answer && typeof chunkObj.answer === 'object') {
              chunkContent = chunkObj.answer[outputVariable]; // Workflow 嘅 JSON output
            } else {
              chunkContent = chunkObj.answer; // Chat 模式嘅 output
            }
            // --- 格式處理完畢 ---

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
              res.write(
                "data: " +
                  JSON.stringify({
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: chunkCreated,
                    model: data.model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          content: chunkContent,
                        },
                        finish_reason: null,
                      },
                    ],
                  }) +
                  "\n\n"
              );
            }
          } } else if (chunkObj.event === "workflow_finished" || chunkObj.event === "message_end") {
            const chunkId = `chatcmpl-${Date.now()}`;
            const chunkCreated = chunkObj.created_at;
            if (!isResponseEnded) {
            res.write(
              "data: " +
                JSON.stringify({
                  id: chunkId,
                  object: "chat.completion.chunk",
                  created: chunkCreated,
                  model: data.model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
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
      // (非 Stream 模式嘅邏輯保持不變，但佢都會受惠於上面 requestBody 嘅改動)
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
          } else if (chunkObj.event === "agent_thought") {
          } else if (chunkObj.event === "ping") {
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
          const formattedResponse = {
            id: `chatcmpl-${generateId()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: data.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: result.trim(),
                },
                logprobs: null,
                finish_reason: "stop",
              },
            ],
            usage: usageData,
            system_fingerprint: "fp_2f57f81c11",
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