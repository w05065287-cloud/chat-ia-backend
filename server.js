// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "20kb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 40
  })
);

app.get("/", (req, res) => {
  res.json({ status: "Backend online ✅" });
});

function ensureApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    const e = new Error("OPENAI_API_KEY not set");
    e.code = "NO_API_KEY";
    throw e;
  }
}

// Helper: try models in order until one works
async function callResponsesAPI({ message, stream = false, models = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-3.5-turbo"] }) {
  ensureApiKey();
  const apiKey = process.env.OPENAI_API_KEY;

  let lastErr = null;
  for (const model of models) {
    try {
      const url = "https://api.openai.com/v1/responses";
      const body = { model, input: message, ...(stream ? { stream: true } : {}) };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        // read body for diagnostics
        let errBody;
        try { errBody = await resp.json(); } catch (e) { errBody = await resp.text(); }
        // if model not found / unavailable, try next; otherwise throw
        if (resp.status === 404 || (typeof errBody === "object" && errBody?.error?.message && /model/i.test(errBody.error.message))) {
          console.warn(`Model ${model} not available, trying next.`, errBody);
          lastErr = errBody;
          continue;
        }
        const err = new Error(`OpenAI responded ${resp.status}: ${JSON.stringify(errBody)}`);
        err.code = resp.status;
        throw err;
      }

      return { resp, model };
    } catch (err) {
      lastErr = err;
      console.warn("callResponsesAPI try failed for model", model, err?.message || err);
      // try next model
    }
  }
  const finalErr = new Error("All models failed");
  finalErr.detail = lastErr;
  throw finalErr;
}

/**
 * POST /chat
 * - Accepts JSON { message: "..." }
 * - If client requests streaming (query ?stream=1 or Accept includes stream), returns plain text chunks
 * - Otherwise returns JSON: { reply: "..." }
 */
app.post("/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").toString();
    if (!message) return res.status(400).json({ error: "Mensagem vazia" });

    const wantsStream = (String(req.query?.stream || "").toLowerCase() === "1")
      || String(req.headers["accept"] || "").includes("text/event-stream")
      || String(req.headers["accept"] || "").includes("stream")
      || false;

    if (!wantsStream) {
      // non-stream: call once and return JSON
      const { resp, model } = await callResponsesAPI({ message, stream: false });
      const data = await resp.json();

      // Responses API often provides output_text or output array
      const reply =
        data.output_text ||
        (Array.isArray(data.output) && data.output.length && (() => {
          const out = data.output[0];
          if (typeof out === "string") return out;
          if (out?.content) {
            // content may be array of objects or string
            if (typeof out.content === "string") return out.content;
            if (Array.isArray(out.content)) return out.content.map(c => c.text || c).join("");
          }
          return null;
        })()) ||
        null;

      if (!reply) {
        console.error("OpenAI returned unexpected non-stream response:", JSON.stringify(data).slice(0, 2000));
        return res.status(500).json({ error: "IA não retornou texto" });
      }

      return res.json({ reply });
    } else {
      // Streaming path - stream plain text chunks (no SSE wrapper)
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const { resp } = await callResponsesAPI({ message, stream: true });

      // Node-fetch may provide a WHATWG reader or async iterable; handle both
      const reader = resp.body?.getReader ? resp.body.getReader() : null;
      const decoder = new TextDecoder("utf-8");

      // Helper to process chunk text and extract only useful text parts
      const processTextChunk = (chunkText) => {
        // Split into lines and handle lines starting with "data:"
        const pieces = [];
        const lines = chunkText.split("\n").filter(Boolean);
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.replace(/^data:\s*/, "");
          if (payload === "[DONE]") {
            pieces.push("[DONE]");
            continue;
          }
          try {
            const json = JSON.parse(payload);
            // The response stream can include various shapes. Try to extract text deltas in common fields.
            const deltaText =
              json?.delta?.text ||
              json?.output_text ||
              (json?.output && Array.isArray(json.output) && json.output[0] && (
                (typeof json.output[0].content === "string") ? json.output[0].content :
                  (Array.isArray(json.output[0].content) ? json.output[0].content.map(c => c.text || "").join("") : null)
              )) ||
              json?.choices?.[0]?.delta?.content ||
              json?.choices?.[0]?.text ||
              null;

            if (deltaText) pieces.push(deltaText);
          } catch (e) {
            // ignore parse errors
          }
        }
        return pieces;
      };

      try {
        if (reader) {
          // WHATWG stream reader
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const txt = decoder.decode(value, { stream: true });
            const parts = processTextChunk(txt);
            for (const p of parts) {
              if (p === "[DONE]") {
                try { res.end(); } catch {}
                return;
              }
              // write plain token/text
              res.write(p);
            }
          }
          try { res.end(); } catch {}
          return;
        } else {
          // async iterable (older node-fetch)
          for await (const chunkBuf of resp.body) {
            const txt = decoder.decode(chunkBuf, { stream: true });
            const parts = processTextChunk(txt);
            for (const p of parts) {
              if (p === "[DONE]") {
                try { res.end(); } catch {}
                return;
              }
              res.write(p);
            }
          }
          try { res.end(); } catch {}
          return;
        }
      } catch (err) {
        console.error("Streaming error:", err);
        try { res.end(); } catch {}
        return;
      }
    }
  } catch (err) {
    console.error("POST /chat error:", err);
    const message = err?.message || "Erro interno";
    try { return res.status(500).json({ error: message }); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
