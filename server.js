const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'candyai';
const EMERGENT_LLM_KEY = process.env.EMERGENT_LLM_KEY || '';

let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('MongoDB connected');
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Candy AI Backend running' });
});

// Get all chats
app.get('/api/chats', async (req, res) => {
  try {
    const chats = await db.collection('chats').find({}).sort({ updatedAt: -1 }).toArray();
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new chat
app.post('/api/chats', async (req, res) => {
  try {
    const { name, persona } = req.body;
    const chat = {
      name: name || 'Nova Conversa',
      persona: persona || 'És uma assistente amigável e carinhosa.',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('chats').insertOne(chat);
    res.json({ ...chat, _id: result.insertedId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get messages from a chat
app.get('/api/chats/:id/messages', async (req, res) => {
  try {
    const chat = await db.collection('chats').findOne({ _id: new ObjectId(req.params.id) });
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    res.json(chat.messages || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send message
app.post('/api/chats/:id/messages', async (req, res) => {
  try {
    const { message } = req.body;
    const chat = await db.collection('chats').findOne({ _id: new ObjectId(req.params.id) });
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    const userMsg = { role: 'user', content: message, timestamp: new Date() };
    const history = (chat.messages || []).slice(-10); // last 10 messages for context

    // Call AI
    const response = await fetch('https://llm.emergentmind.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${EMERGENT_LLM_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: chat.persona },
          ...history.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message }
        ],
        max_tokens: 500
      })
    });

    const aiData = await response.json();
    const aiReply = aiData.choices?.[0]?.message?.content || 'Desculpa, não consegui responder.';

    const assistantMsg = { role: 'assistant', content: aiReply, timestamp: new Date() };

    await db.collection('chats').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $push: { messages: { $each: [userMsg, assistantMsg] } },
        $set: { updatedAt: new Date() }
      }
    );

    res.json({ reply: aiReply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete chat
app.delete('/api/chats/:id', async (req, res) => {
  try {
    await db.collection('chats').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
