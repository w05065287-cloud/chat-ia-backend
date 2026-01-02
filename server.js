import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const app = express();

app.use(express.json());
app.use(helmet());

app.use(cors({
  origin: "*"
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 20
}));

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
          temperature: 0.6,
          max_tokens: 600
        })
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});
