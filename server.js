import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30
}));

app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
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
          stream: true
        })
      }
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

      for (const line of lines) {
        const data = line.replace("data: ", "").trim();
        if (data === "[DONE]") {
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const token = json.choices?.[0]?.delta?.content;
          if (token) {
            res.write(`data: ${token}\n\n`);
          }
        } catch {}
      }
    }

  } catch (err) {
    res.write(`data: ERRO\n\n`);
    res.end();
  }
});

app.listen(process.env.PORT || 3000);
