import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 20
  })
);

app.get("/", (req, res) => {
  res.json({ status: "Backend com streaming OK ✅" });
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).end();

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: message }],
          stream: true
        })
      }
    );

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    for await (const chunk of response.body) {
      const lines = chunk.toString().split("\n").filter(Boolean);

      for (const line of lines) {
        if (line.includes("[DONE]")) {
          res.end();
          return;
        }

        if (line.startsWith("data:")) {
          const json = JSON.parse(line.replace("data: ", ""));
          const token = json.choices?.[0]?.delta?.content;
          if (token) res.write(token);
        }
      }
    }

  } catch (err) {
    console.error(err);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor streaming na porta", PORT);
});
