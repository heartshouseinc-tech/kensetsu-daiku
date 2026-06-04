const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

exports.askClaude = onRequest(
  { secrets: [GEMINI_API_KEY], cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }
    try {
      const { messages } = req.body;
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      const prompt = messages.map(m => m.content).join("\n");
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      res.json({ content: [{ type: "text", text }] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);
