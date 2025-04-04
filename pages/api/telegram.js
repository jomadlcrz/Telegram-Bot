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

const conversationHistory = new Map();  // Store conversation history (use a database for persistence)

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

        // Handle Audio Messages
        if (audio) {
          const audioFileId = audio.file_id;
          
          // Get audio file information
          const fileResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_API_KEY}/getFile`, {
            params: {
              file_id: audioFileId,
            },
          });

          const filePath = fileResponse.data.result.file_path;
          const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_API_KEY}/${filePath}`;

          // Download the audio file
          const audioStream = await axios({
            url: fileUrl,
            method: "GET",
            responseType: "stream",
          });

          const audioFilePath = `/tmp/audio-${audioFileId}.mp3`;  // Temporary path to store the audio file
          const writer = createWriteStream(audioFilePath);
          await streamPipeline(audioStream.data, writer);  // Stream and save the file

          // Upload audio to Gemini API (you can use File API here or base64 if small file)
          const base64Audio = await new Promise((resolve, reject) => {
            const fileBuffer = [];
            writer.on('finish', () => {
              const audioBuffer = require('fs').readFileSync(audioFilePath);
              resolve(audioBuffer.toString('base64'));
            });
            writer.on('error', reject);
          });

          // Send the audio as inline data to Gemini API
          const aiResponse = await ai.models.generateContent({
            model: "gemini-1.5-flash",  // Your chosen model
            contents: [
              { text: "Please summarize the audio." },
              { inlineData: { mimeType: "audio/mpeg", data: base64Audio } },
            ],
          });

          const responseText = aiResponse.text;

          // Send AI response back to Telegram
          await axios.post(TELEGRAM_URL, {
            chat_id: chat.id,
            text: responseText,
            parse_mode: "Markdown",
          });

          return res.status(200).json({ status: "success" });
        }

        // Handle text-based user messages
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
