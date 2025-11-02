import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { handleRAGChat } from "./ragService.js"; // your existing chat logic

dotenv.config();

const app = express();

// ✅ Allow frontend (Vercel) + local dev
const allowedOrigin =
  process.env.ALLOWED_ORIGIN || "http://localhost:5000";

app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());
app.use(bodyParser.json());

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Argo Float Chatbot Backend is running!");
});

// ✅ Chat route for RAG chatbot
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const response = await handleRAGChat(message);
    res.json({ reply: response });
  } catch (err) {
    console.error("❌ Chat API error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ error: "Something went wrong!" });
});

// ✅ Port setup (for Railway or local)
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Allowed origin: ${allowedOrigin}`);
});
