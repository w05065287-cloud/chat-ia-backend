import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

// Segurança
app.use(helmet());

app.use(cors({
  origin: "*",
  methods: ["POST"],
}));

app.use(express.json());

// Limite de requisições (anti-spam)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20
});
app.use("/chat", limiter);

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

    // Log para debug
    console.log("OpenAI:", JSON.stringify(data, null, 2));

    res.json(data);

  } catch (err) {
    console.error("Erro no backend:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend OK na porta", PORT);
});
