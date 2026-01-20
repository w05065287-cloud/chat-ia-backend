import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/perguntar", async (req, res) => {
  const pergunta = req.body.pergunta;

  try {
    const respostaIA = await fetch("https://api.exemplo.com/ia", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.API_KEY}`
      },
      body: JSON.stringify({
        pergunta: pergunta
      })
    });

    const dados = await respostaIA.json();

    res.json({
      resposta: dados.resposta || "Sem resposta da IA"
    });

  } catch (erro) {
    res.status(500).json({
      resposta: "Erro ao conectar com a IA"
    });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
