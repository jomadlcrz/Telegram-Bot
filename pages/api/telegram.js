// pages/api/telegram.js
import { GoogleGenAI } from "@google/genai";
import axios from "axios";

// Initialize the Google Gemini AI client using environment variable
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY, // Use environment variable for API key
});

const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY; // Use environment variable for Telegram Bot API Key
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_API_KEY}/sendMessage`;
const TELEGRAM_EDIT_URL = `https://api.telegram.org/bot${TELEGRAM_API_KEY}/editMessageText`;

// In-memory store for user contexts (conversation history)
const userContexts = new Map();

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { message } = req.body;

    if (message) {
      const { text, chat } = message;
      const userMessage = text;
      const userId = chat.id;

      try {
        // Initialize user context if it's a new user
        if (!userContexts.has(userId)) {
          userContexts.set(userId, [
            {
              role: "system",
              content: "You are a helpful Telegram AI assistant. Be concise and friendly."
            }
          ]);
        }

        // Add the user's message to the context
        const context = userContexts.get(userId);
        context.push({
          role: "user",
          content: userMessage
        });

        // Send the "Processing your request..." message
        const processingMessage = await axios.post(TELEGRAM_URL, {
          chat_id: userId,
          text: "_Processing your request..._",
          parse_mode: "Markdown",
        });

        const messageId = processingMessage.data.result.message_id; // Store message ID for later update

        // Request Gemini API to generate content based on user context
        const aiResponse = await ai.models.generateContent({
          model: "gemini-1.5-flash", // Choose your model here
          contents: context.map(entry => `${entry.role}: ${entry.content}`).join("\n"), // Use context
        });

        const responseText = aiResponse.text;

        // Add the assistant's response to the context
        context.push({
          role: "assistant",
          content: responseText
        });

        // Store the updated context
        userContexts.set(userId, context);

        // Edit the "Processing your request..." message with the AI response
        await axios.post(TELEGRAM_EDIT_URL, {
          chat_id: userId,
          message_id: messageId,
          text: responseText,
          parse_mode: "Markdown",
        });

        return res.status(200).json({ status: "success" });
      } catch (error) {
        console.error("Error generating content:", error);
        await axios.post(TELEGRAM_URL, {
          chat_id: userId,
          text: "Oops! Something went wrong. 😅 Let me try again.",
          parse_mode: "Markdown",
        });
        return res.status(500).json({ error: "Error generating content" });
      }
    } else {
      return res.status(400).json({ error: "No message found" });
    }
  } else {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
}
