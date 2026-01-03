import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

/* Segurança básica */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10kb" }));

/* Anti-abuso */
app.use(
  rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20
  })
);

/* Rota teste */
app.get("/", (req, res) => {
  res.json({ status: "Backend funcionando ✅" });
});

/* Chat */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensagem vazia" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: message }],
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!data.choices) {
      console.error(data);
      return res.status(500).json({ error: "Erro da OpenAI" });
    }

    res.json({
      reply: data.choices[0].message.content
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
