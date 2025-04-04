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

// In-memory store for conversation history (this can be replaced with a database for persistence)
const conversationHistory = new Map();

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { message } = req.body;

    if (message) {
      const { text, chat } = message;
      const userMessage = text;

      try {
        // Handle /start command
        if (userMessage === "/start") {
          await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: `👋 Hi there! I'm your friendly Gemini AI assistant! 🤖💬 How can I help you today? 😊\n\nFeel free to ask me anything or check out my GitHub profile: [jomadlcrz](https://github.com/jomadlcrz) 🙌`,
            parse_mode: "Markdown", // Use Markdown for formatting
          });
          return res.status(200).json({ status: "success" });
        }

        // Handle /reset command
        if (userMessage === "/reset") {
          conversationHistory.delete(chat.id); // Reset the conversation history for the user
          await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: "*Conversation reset!* 🎉✅ _You can now start fresh. Just ask me anything._",
            parse_mode: "Markdown", // Set parse mode if needed
          });
          return res.status(200).json({ status: "success" });
        }

        // Send a "Processing your request..." message first and store the message ID
        const sentMessage = await axios.post(TELEGRAM_URL, {
          chat_id: chat.id,
          text: "_Hold on, I'm working on it..._ 🧠✨",
          parse_mode: "Markdown", // Use Markdown formatting for processing message
        });

        const messageId = sentMessage.data.result.message_id; // Store the message ID of the sent message

        // Retrieve the previous conversation history for the user (if any)
        let history = conversationHistory.get(chat.id) || [];

        // Add the new message to the conversation history
        history.push(`User: ${userMessage}`);

        // Request Gemini API to generate content based on the entire conversation history
        const aiResponse = await ai.models.generateContent({
          model: "gemini-1.5-flash", // Choose your model here
          contents: history.join("\n"), // Join all history as a single input
        });

        const responseText = aiResponse.text;

        // Add the AI response to the conversation history (no "AI:" prefix)
        history.push(responseText); // Just add the raw response

        // Store the updated conversation history
        conversationHistory.set(chat.id, history);

        // Edit the "Processing your request..." message with the actual AI response
        await axios.post(TELEGRAM_EDIT_URL, {
          chat_id: chat.id,
          message_id: messageId,
          text: responseText,
          parse_mode: "Markdown", // Set parse mode for formatting
        });

        return res.status(200).json({ status: "success" });
      } catch (error) {
        console.error("Error generating content:", error);
        return res.status(500).json({ error: "Oops! Something went wrong while processing your request. 😔 Please try again." });
      }
    } else {
      return res.status(400).json({ error: "Whoops! I couldn't find any message. 😕 Please send me a message." });
    }
  } else {
    return res.status(405).json({ error: "Oops! That method is not allowed. Please use POST requests." });
  }
}
