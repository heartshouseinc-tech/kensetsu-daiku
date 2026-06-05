const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

exports.askClaude = onRequest(
  { secrets: [GEMINI_API_KEY], cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }
    try {
      const { prompt, model, mediaContents, messages } = req.body;
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const modelName = model || "gemini-2.0-flash"-001;
      const geminiModel = genAI.getGenerativeModel({ model: modelName });

      let result;

      if (mediaContents && mediaContents.length > 0) {
        const parts = [{ text: prompt }];
        for (const f of mediaContents) {
          const base64 = f.base64.replace(/^data:[^;]+;base64,/, "");
          const mimeType = f.type || "image/jpeg";
          parts.push({ inlineData: { mimeType, data: base64 } });
        }
        result = await geminiModel.generateContent(parts);
      } else if (messages) {
        const text = messages.map(m => m.content).join("\n");
        result = await geminiModel.generateContent(text);
      } else {
        result = await geminiModel.generateContent(prompt || "");
      }

      const text = result.response.text();
      res.json({
        candidates: [{
          content: {
            parts: [{ text: text }],
            role: "model"
          },
          finishReason: "STOP"
        }]
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);
