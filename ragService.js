// backend/ragService.js
import * as dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pool from './db.js'; // --- NEW: IMPORT THE DATABASE POOL ---

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const conversationHistory = [];

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
};

// --- HELPER FUNCTIONS (Your original code) ---

function extractTextFromResponse(response) {
  try {
    if (!response?.response) return "";
    return response.response.text() || "";
  } catch (error) {
    console.error("Error extracting text:", error);
    return "";
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, retries = RETRY_CONFIG.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
        RETRY_CONFIG.maxDelay
      );
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      console.log(`Error: ${error.message}`);
      await sleep(delay);
    }
  }
}

async function fetchFromGoogle(query) {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cx) {
      console.log("Google Search not configured, returning empty");
      return "";
    }
    console.log("Searching Google for:", query);
    let searchQuery = `${query} oceanography ocean data`;
    const response = await axios.get(
      "https://www.googleapis.com/customsearch/v1",
      {
        params: { key: apiKey, cx: cx, q: searchQuery, num: 5, safe: 'active' },
        timeout: 15000
      }
    );
    if (response.data?.items?.length) {
      const results = response.data.items
        .slice(0, 3)
        .map((item) => {
          const snippet = (item.snippet || '').replace(/\s+/g, ' ').replace(/\.\.\./g, '').trim();
          return `Title: ${item.title}\nSnippet: ${snippet}`;
        })
        .join("\n\n---\n\n");
      console.log("Google search successful, returning combined snippets.");
      return results;
    } else {
      console.log("No Google search results found");
      return "";
    }
  } catch (error) {
    console.error("Google Search error:", error.message);
    return "";
  }
}

function transformQuery(question) {
  return question
    .toLowerCase()
    .trim()
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

function isGreeting(query) {
  const greetings = ['hi', 'hii', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon'];
  const cleanQuery = query.toLowerCase().trim();
  return greetings.some(greeting => {
    const regex = new RegExp(`\\b${greeting}\\b`, 'i');
    return regex.test(cleanQuery);
  });
}

function isOceanRelated(question) {
    const questionLower = question.toLowerCase();
    const ambiguousKeywords = ['biology', 'geology', 'chemistry', 'physics', 'animals', 'plants', 'environment'];
    const oceanContextKeywords = ['ocean', 'sea', 'marine', 'maritime', 'aquatic', 'coastal', 'nautical', 'water', 'deep sea', 'hydrothermal', 'bay', 'gulf'];
    const hasAmbiguousTerm = ambiguousKeywords.some(keyword => questionLower.includes(keyword));
    const hasOceanContext = oceanContextKeywords.some(keyword => questionLower.includes(keyword));

    if (hasAmbiguousTerm && !hasOceanContext) {
        console.log(`Ambiguous term found without ocean context. Rejecting.`);
        return false;
    }

    const allOceanKeywords = [
        ...oceanContextKeywords, ...ambiguousKeywords,
        'salinity', 'temperature', 'tide', 'wave', 'current', 'shore', 'beach',
        'trench', 'abyss', 'oceanography', 'bathymetry', 'sea level', 'strait',
        'pressure', 'nitrogen', 'nutrients', 'sediment', 'ph', 'nitrate', 'phosphate',
        'oxygen', 'chlorophyll', 'dissolved gas', 'carbon dioxide', 'co2',
        'coral', 'reef', 'fish', 'whale', 'dolphin', 'shark', 'plankton',
        'algae', 'kelp', 'bioluminescence', 'phytoplankton', 'zooplankton',
        'crustacean', 'mollusk', 'marine life', 'ship', 'boat', 'submarine',
        'argo float', 'buoy', 'tsunami', 'seafood', 'fishing', 'overfishing',
        'pollution', 'plastic', 'acidification', 'atlantic', 'pacific', 'indian',
        'arctic', 'antarctic', 'mediterranean', 'seamount', 'guyot', 'continental shelf',
        'mid-ocean ridge', 'atoll', 'lagoon', 'estuary', 'fjord', 'delta',
        'thermohaline circulation', 'upwelling', 'downwelling', 'gyre', 'El Niño',
        'La Niña', 'Coriolis effect', 'sonar', 'hydrography', 'acoustics',
        'ecosystem', 'food web', 'biodiversity', 'species', 'cetacean', 'pinniped',
        'seabird', 'mangrove', 'seagrass', 'echinoderm', 'cnidarian',
        'ROV', 'AUV', 'aquaculture', 'desalination', 'offshore', 'port', 'harbor',
        'dredging', 'anoxia', 'hypoxia', 'dead zone', 'eutrophication', 'oil spill',
        'microplastics', 'carbon cycle', 'carbon sink', 'Ocean Tides'
    ];

    return allOceanKeywords.some(keyword => questionLower.includes(keyword));
}


function isContextRelevant(question, context) {
    if (!context || context.trim().length < 20) return false;
    const questionLower = question.toLowerCase();
    const contextLower = context.toLowerCase();
    const oceanTerms = ['ocean', 'sea', 'marine', 'water', 'salinity', 'temperature', 'depth', 'current', 'tide', 'wave', 'coastal', 'atlantic', 'pacific', 'indian', 'arctic'];
    const coordinateTerms = ['lat', 'latitude', 'lon', 'longitude', 'degree', 'coordinate', 'Ocean tides'];
    const hasOceanTerms = oceanTerms.some(term => questionLower.includes(term));
    const hasCoordinateTerms = coordinateTerms.some(term => questionLower.includes(term));
    if (hasOceanTerms || hasCoordinateTerms) {
        const contextHasOceanTerms = oceanTerms.some(term => contextLower.includes(term));
        if (!contextHasOceanTerms) {
            console.log("Question is about ocean, but context is not.");
            return false;
        }
    }
    const questionWords = new Set(questionLower.split(/\s+/).filter(word => word.length > 3));
    const contextWords = new Set(contextLower.split(/\s+/));
    const commonWords = [...questionWords].filter(word => contextWords.has(word));
    const overlapRatio = commonWords.length / Math.max(questionWords.size, 1);
    if (overlapRatio < 0.1) {
        console.log(`Low keyword overlap: ${overlapRatio.toFixed(2)}`);
        return false;
    }
    return true;
}

async function generateAIResponse(prompt, question) {
  const models = [
    { name: "gemini-2.5-flash", config: { temperature: 0.5, maxOutputTokens: 2048 } },
  ];
  for (const modelInfo of models) {
    try {
      console.log(`Trying model: ${modelInfo.name}`);
      const response = await retryWithBackoff(async () => {
        const model = genAI.getGenerativeModel({
          model: modelInfo.name,
          generationConfig: modelInfo.config
        });
        return await model.generateContent(prompt);
      });
      const answer = extractTextFromResponse(response);
      if (answer && answer.trim().length > 0) {
        console.log(`Successfully generated response using ${modelInfo.name}`);
        return answer;
      }
    } catch (error) {
      console.error(`Model ${modelInfo.name} failed:`, error.message);
      if (error.message.includes('overloaded') || error.message.includes('503') || error.message.includes('429')) {
        await sleep(2000);
      }
      continue;
    }
  }
  console.log("All AI models failed, providing fallback response");
  return generateFallbackResponse(question);
}

function generateFallbackResponse(question) {
  return "I am currently experiencing high demand and cannot generate a detailed response. Please try again in a moment. For urgent oceanographic data inquiries, I recommend consulting official sources like NOAA or Copernicus.";
}

// --- MAIN CHATTING FUNCTION ---

export async function chatting(question) {
  try {
    // --- NEW: STEP 1 - CHECK POSTGRESQL CACHE FIRST ---
    try {
      console.log("Checking PostgreSQL cache for question:", question);
      const cacheQuery = 'SELECT answer FROM question_cache WHERE question = $1';
      const { rows } = await pool.query(cacheQuery, [question]);

      if (rows.length > 0) {
        console.log("CACHE HIT! Returning stored response from database.");
        return rows[0].answer;
      }
      console.log("CACHE MISS. Proceeding to generate a new response.");
    } catch (dbError) {
      console.error("Database cache check error:", dbError.message);
      // If the cache check fails, log the error but continue as a cache miss.
    }
    // --- END OF CACHE CHECK ---


    // --- YOUR ORIGINAL OPTIMIZED CODE STARTS HERE ---
    console.log("Processing question:", question);

    if (isGreeting(question)) {
      const greeting = "Hello! I am ARGO, your Oceanography Assistant. How can I help you with marine data today?";
      conversationHistory.push(
        { role: "user", parts: [{ text: question }] },
        { role: "model", parts: [{ text: greeting }] }
      );
      return greeting;
    }

    if (!isOceanRelated(question)) {
        return "I am an oceanography assistant. My knowledge is focused on marine science, so I can only respond to questions related to the ocean. Please ask me something about a marine topic.";
    }

    const cleanedQuery = transformQuery(question);
    console.log("Cleaned query:", cleanedQuery);

    let context = "";
    let contextSource = "no context";

    try {
      console.log("Generating embeddings...");
      const embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GEMINI_API_KEY,
        model: "text-embedding-004",
      });
      const queryVector = await embeddings.embedQuery(cleanedQuery);

      console.log("Searching Pinecone database...");
      const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
      const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

      const searchResults = await pineconeIndex.query({
        topK: 5,
        vector: queryVector,
        includeMetadata: true,
      });

      if (searchResults.matches?.length) {
        const threshold = 0.5;
        const relevantMatches = searchResults.matches.filter(match => match.score > threshold);
        
        if (relevantMatches.length > 0) {
          const potentialContext = relevantMatches
            .map(match => match.metadata?.text || "")
            .filter(text => text.length > 0)
            .join("\n\n");
          
          if (isContextRelevant(question, potentialContext)) {
            context = potentialContext;
            contextSource = "Internal Database";
            console.log("Using relevant database context.");
          } else {
            console.log("Database context found but deemed not relevant.");
          }
        }
      }
    } catch (dbError) {
      console.error("Database search error:", dbError.message);
    }

    if (!context) {
      console.log("No relevant database context, trying Google search...");
      context = await fetchFromGoogle(cleanedQuery);
      if (context) {
        contextSource = "External Search";
        console.log("Using Google search context.");
      }
    }

    const systemPrompt = `You are ARGO, an expert Oceanography Assistant. Your primary goal is to provide accurate, direct, and helpful answers to user questions about marine science.

**Core Instructions:**
1.  **Synthesize, Don't Recite:** Use the provided "Context" below as your primary source of information. Do NOT just repeat what the context says or talk about the context. Synthesize the information into a complete, coherent answer that directly addresses the user's question.
2.  **Fill the Gaps:** If the provided context is insufficient or doesn't directly answer the question, you MUST use your own extensive knowledge of oceanography to provide the best possible answer.
3.  **Never Expose Your Tools:** Do NOT mention "the provided context," "the search results," or "the database." The user should feel like they are talking to a single, knowledgeable expert.
4.  **No Excuses:** NEVER say "I don't have information," "I cannot answer," or that you lack data. If you don't have a precise value (e.g., temperature at exact coordinates), provide a scientifically-backed estimate, a typical range for that region/season, and explain the factors that influence the value. Always provide a useful and informative response.
5.  **Be Factual and Concise:** Prioritize data like salinity, temperature, nutrients, oxygen, etc. Keep answers direct and to the point. **If the user asks for a simple fact or definition, provide a short, direct answer. Only provide longer, more detailed explanations when the question requires it (e.g., asking "how" or "why").**`;

    let finalPrompt = `${systemPrompt}\n\n`;
    if (context) {
        finalPrompt += `**Context from ${contextSource}:**\n${context}\n\n`;
    } else {
        finalPrompt += `**Context:** None provided. Rely entirely on your internal knowledge.\n\n`;
    }
    finalPrompt += `**User Question:** ${question}\n\n**Answer:**`;
    
    // Generate AI response
    console.log("Generating AI response with unified prompt...");
    const answer = await generateAIResponse(finalPrompt, question);

    console.log("Response generated successfully");

    // Update and manage conversation history
    conversationHistory.push(
      { role: "user", parts: [{ text: question }] },
      { role: "model", parts: [{ text: answer }] }
    );
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, 2);
    }
    // --- YOUR ORIGINAL OPTIMIZED CODE ENDS HERE ---


    // --- NEW: STEP 2 - STORE THE NEW RESPONSE IN THE CACHE ---
    try {
      console.log("Storing new response in PostgreSQL cache...");
      const insertQuery = 'INSERT INTO question_cache (question, answer) VALUES ($1, $2) ON CONFLICT (question) DO NOTHING';
      await pool.query(insertQuery, [question, answer]);
    } catch (dbError) {
      console.error("Database cache store error:", dbError.message);
      // Log the error, but don't prevent the user from getting their response.
    }
    // --- END OF CACHE STORE ---

    return answer;

  } catch (error) {
    console.error("Critical error in chatting function:", error);
    return generateFallbackResponse(question);
  }
}
