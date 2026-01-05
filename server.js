// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

// Middlewares de segurança e parsing
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "20kb" }));

// Limite simples para evitar abuso
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 40
  })
);

// Pequena rota de status para testar no navegador
app.get("/", (req, res) => {
  res.json({ status: "Backend online ✅" });
});

/**
 * Helper: chama a OpenAI Responses (padrão).
 * Se stream=true, devolve o stream para o cliente.
 */
async function callOpenAI({ message, stream = false, modelHints = [] }) {
  // tente a lista de modelos em ordem até funcionar
  const modelsToTry = [...modelHints];
  if (modelsToTry.length === 0) {
    modelsToTry.push("gpt-4o-mini", "gpt-4.1-mini", "gpt-3.5-turbo");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set in environment");
  }

  for (const model of modelsToTry) {
    try {
      const url = "https://api.openai.com/v1/responses";
      const body = {
        model,
        input: message,
        ...(stream ? { stream: true } : {})
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        // timeout not set; Render handles runtime
      });

      // If non-OK, try next model (but inspect body first)
      if (!resp.ok) {
        let errData;
        try { errData = await resp.json(); } catch(e) { errData = { status: resp.status, text: await resp.text() }; }
        // if model not found or unauthorized, try next model; otherwise throw
        const msg = JSON.stringify(errData);
        if (resp.status === 404 || (errData?.error?.message && /model/i.test(errData.error.message))) {
          // try next model
          console.warn(`Model ${model} not available, trying next. Error: ${msg}`);
          continue;
        }
        // for 401 or others, throw with details
        const e = new Error(`OpenAI responded ${resp.status}: ${msg}`);
        e.status = resp.status;
        throw e;
      }

      // success: return {resp, model} to caller
      return { resp, model };
    } catch (err) {
      // If this was the last model, rethrow; else continue trying
      console.error(`callOpenAI attempt model ${model} failed:`, err?.message || err);
      // if last model, rethrow
      if (modelsToTry.indexOf(model) === modelsToTry.length - 1) throw err;
    }
  }

  throw new Error("All models failed");
}

/**
 * POST /chat
 * - If client sets header Accept: text/event-stream or ?stream=1, backend streams plain text chunks.
 * - Otherwise, backend returns JSON { reply: "..." }.
 */
app.post("/chat", async (req, res) => {
  try {
    const message = (req.body?.message || "").toString();
    if (!message) return res.status(400).json({ error: "Mensagem vazia" });

    // Decide if streaming is requested
    const streamQuery = String(req.query?.stream || "").toLowerCase();
    const acceptHeader = String(req.headers["accept"] || "");
    const wantsStream = streamQuery === "1" || acceptHeader.includes("text/event-stream") || acceptHeader.includes("stream");

    // Try to call OpenAI
    if (!wantsStream) {
      // Non-stream path: call once and return JSON reply
      const { resp, model } = await callOpenAI({ message, stream: false, modelHints: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-3.5-turbo"] });
      const data = await resp.json();
      // Responses API typically returns output_text or output[0].content
      const reply = data.output_text || (data.output && data.output[0] && (
        (typeof data.output[0].content === "string") ? data.output[0].content : (Array.isArray(data.output[0].content) ? (data.output[0].content.map(c => c.text || "").join("")) : "")
      )) || null;

      if (!reply) {
        console.error("OpenAI non-stream response missing output_text:", JSON.stringify(data).slice(0, 1000));
        return res.status(500).json({ error: "IA não retornou resposta" });
      }
      return res.json({ reply });
    } else {
      // Stream path. We'll stream plain text chunks (not SSE) to simplify frontend.
      // Set headers to avoid buffering
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      // Some platforms need this to disable proxy buffering:
      res.setHeader("X-Accel-Buffering", "no");

      // Call OpenAI with stream: true
      const { resp, model } = await callOpenAI({ message, stream: true, modelHints: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-3.5-turbo"] });

      // Node-fetch returns a streaming body we can iterate
      const reader = resp.body.getReader ? resp.body.getReader() : null;

      if (reader) {
        // If body.getReader exists (WHATWG stream), use reader
        const decoder = new TextDecoder("utf-8");
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          // OpenAI server-sent "data: ..." lines — parse them
          const lines = chunk.split("\n").filter(Boolean);
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.startsWith("data:")) {
              const payload = line.replace(/^data:\s*/, "");
              if (payload === "[DONE]") {
                res.end();
                return;
              }
              try {
                const json = JSON.parse(payload);
                // Try different possible fields to extract incremental text
                const token =
                  json?.delta?.content ||
                  (json?.output?.[0]?.content && (typeof json.output[0].content === "string" ? json.output[0].content : (Array.isArray(json.output[0].content) ? json.output[0].content.map(c => c.text || "").join("") : null))) ||
                  json?.choices?.[0]?.delta?.content ||
                  json?.choices?.[0]?.text;
                if (token) {
                  res.write(token);
                }
              } catch (e) {
                // If can't parse JSON, write raw payload
                res.write(payload);
              }
            } else {
              // if it's not data: but text, forward raw
              res.write(line);
            }
          }
        }
        res.end();
        return;
      } else {
        // fallback: stream via async iterator (older node-fetch)
        try {
          const decoder = new TextDecoder("utf-8");
          for await (const chunkBuffer of resp.body) {
            const chunk = decoder.decode(chunkBuffer);
            const lines = chunk.split("\n").filter(Boolean);
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (line.startsWith("data:")) {
                const payload = line.replace(/^data:\s*/, "");
                if (payload === "[DONE]") {
                  res.end();
                  return;
                }
                try {
                  const json = JSON.parse(payload);
                  const token =
                    json?.delta?.content ||
                    json?.choices?.[0]?.delta?.content ||
                    json?.choices?.[0]?.text;
                  if (token) res.write(token);
                } catch (e) {
                  res.write(payload);
                }
              } else {
                res.write(line);
              }
            }
          }
          res.end();
        } catch (err) {
          console.error("Stream fallback error:", err);
          try { res.end(); } catch {}
        }
        return;
      }
    }
  } catch (err) {
    console.error("POST /chat error:", err?.message || err);
    // Provide helpful error message to frontend
    const msg = (err?.message || "Erro interno");
    try { return res.status(500).json({ error: msg }); } catch { /* nothing */ }
  }
});

// Start
const PORT = process.env.PORT || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
