import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { chatting } from './ragService.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*", // you’ll update this to your Vercel frontend later
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Argo Float Chatbot backend running',
    time: new Date().toISOString()
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: 'Missing question' });
    }

    console.log('Incoming question:', question);
    const answer = await chatting(question.trim());
    return res.json({ answer });

  } catch (err) {
    console.error('Error in /api/chat:', err);
    return res.status(500).json({
      error: 'Internal server error',
      answer: 'I encountered an issue processing your question.'
    });
  }
});

// 404
app.use((req, res) => res.status(404).json({
  error: 'Not found',
  message: 'Endpoint does not exist.'
}));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('Environment check:');
  [
    'GEMINI_API_KEY',
    'PINECONE_API_KEY',
    'PINECONE_INDEX_NAME',
    'DATABASE_URL'
  ].forEach(v => console.log(`- ${v}:`, process.env[v] ? '✅ Set' : '❌ Missing'));
});
