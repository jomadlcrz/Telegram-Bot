import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import { createWriteStream } from "fs";
import { promisify } from "util";
import { pipeline } from "stream";

// Initialize the Google Gemini AI client using environment variable
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY, // Use environment variable for API key
});

const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY; // Use environment variable for Telegram Bot API Key
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_API_KEY}/sendMessage`;
const TELEGRAM_EDIT_URL = `https://api.telegram.org/bot${TELEGRAM_API_KEY}/editMessageText`;
const TELEGRAM_UPLOAD_URL = `https://api.telegram.org/bot${TELEGRAM_API_KEY}/sendPhoto`;

const conversationHistory = new Map(); // Store conversation history

const streamPipeline = promisify(pipeline);

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { message } = req.body;

    if (message) {
      const { text, chat, audio } = message;
      const userMessage = text;

      try {
        // Handle /start command
        if (userMessage === "/start") {
          await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: "Hey there! 👋 I'm Gemini AI assistant, here to help you with anything you need. 😊\n\nFeel free to ask me anything, and if you're curious, check out my GitHub profile: [jomadlcrz](https://github.com/jomadlcrz)",
            parse_mode: "Markdown",
          });
          return res.status(200).json({ status: "success" });
        }

        // Handle /reset command
        if (userMessage === "/reset") {
          conversationHistory.delete(chat.id);  // Reset the conversation history for the user
          await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: "Conversation reset. Start a new conversation by asking a question.",
            parse_mode: "Markdown",
          });
          return res.status(200).json({ status: "success" });
        }

        // Handle Image Generation Request (Command: /generate_image)
        if (userMessage.startsWith("/generate_image")) {
          const prompt = userMessage.replace("/generate_image", "").trim();

          if (!prompt) {
            await axios.post(TELEGRAM_URL, {
              chat_id: chat.id,
              text: "Please provide a description after /generate_image to create an image.",
            });
            return res.status(200).json({ status: "success" });
          }

          // Request Gemini API to generate content with text and image
          const response = await ai.models.generateContent({
            model: "gemini-2.0-flash-exp-image-generation",
            contents: prompt,
            config: {
              responseModalities: ["Text", "Image"],  // Include text and image in the response
            },
          });

          // Process the response and handle text and image output
          let imageBuffer = null;
          let responseText = "";

          for (const part of response.candidates[0].content.parts) {
            if (part.text) {
              responseText += part.text;  // Collect the text response
            } else if (part.inlineData) {
              const imageData = part.inlineData.data;
              imageBuffer = Buffer.from(imageData, "base64");  // Convert base64 to image buffer
            }
          }

          // If an image was generated, upload it to Telegram
          if (imageBuffer) {
            const imagePath = "/tmp/generated-image.png";  // Temporary file path
            createWriteStream(imagePath).write(imageBuffer);

            const form = new FormData();
            form.append("chat_id", chat.id);
            form.append("photo", imageBuffer, "generated-image.png");

            await axios.post(TELEGRAM_UPLOAD_URL, form, {
              headers: form.getHeaders(),
            });
          }

          // Send the text response along with the image
          await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: responseText,
            parse_mode: "Markdown",
          });

          return res.status(200).json({ status: "success" });
        }

        // Handle other text-based user messages
        if (userMessage) {
          // Send a "Processing your request..." message
          const sentMessage = await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: "Processing your request...",
            parse_mode: "Markdown",
          });

          const messageId = sentMessage.data.result.message_id;

          // Retrieve and update conversation history
          let history = conversationHistory.get(chat.id) || [];
          history.push(`User: ${userMessage}`);

          const aiResponse = await ai.models.generateContent({
            model: "gemini-1.5-flash", // Your model choice
            contents: history.join("\n"),  // Join all history as a single input
          });

          const responseText = aiResponse.text;
          history.push(responseText); // Store AI response

          conversationHistory.set(chat.id, history);

          // Edit the "Processing your request..." message with AI response
          await axios.post(TELEGRAM_EDIT_URL, {
            chat_id: chat.id,
            message_id: messageId,
            text: responseText,
            parse_mode: "Markdown",
          });

          return res.status(200).json({ status: "success" });
        }
      } catch (error) {
        console.error("Error processing request:", error);
        return res.status(500).json({ error: "Error processing request" });
      }
    } else {
      return res.status(400).json({ error: "No message found" });
    }
  } else {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
}
