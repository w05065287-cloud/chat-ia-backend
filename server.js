import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

// Segurança básica
app.use(helmet());
app.use(cors());
app.use(express.json());

// Limite de requisições (anti-abuso)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 20
  })
);

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensagem vazia" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: message
      })
    });

    const data = await response.json();

    if (!data.output_text) {
      console.error("Erro OpenAI:", data);
      return res.status(500).json({ error: "Erro ao gerar resposta" });
    }

    res.json({ reply: data.output_text });

  } catch (err) {
    console.error("Erro backend:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend rodando na porta", PORT);
});
