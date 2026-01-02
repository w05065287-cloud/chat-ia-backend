import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

/* 🔒 Segurança básica */
app.use(helmet());
app.use(cors());
app.use(express.json());

/* 🚫 Anti-spam (proteção) */
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30 // 30 requisições por IP
});
app.use(limiter);

app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Mensagens inválidas" });
    }

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.6
        })
      }
    );

    const data = await response.json();

    // 🔍 Log para debug no Render
    console.log("Resposta OpenAI:", JSON.stringify(data, null, 2));

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    res.json(data);

  } catch (err) {
    console.error("Erro no backend:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend rodando na porta", PORT);
});
