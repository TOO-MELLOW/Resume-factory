// api/ai-generate.js
//
// Serverless function that proxies AI writing requests to Groq.
// GROQ_API_KEY lives only in Vercel's Environment Variables — it is
// never sent to, or visible in, the browser.
//
// Deploy location: put this file at  api/ai-generate.js  in the repo root
// (same level as index.html). Vercel auto-detects anything in /api as a
// serverless function, no config file needed.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Missing prompt" });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: "Prompt too long" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is not set in Vercel environment variables");
    return res.status(500).json({ error: "AI service not configured" });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b", // current recommended production model on Groq
        messages: [
          {
            role: "system",
            content:
              "You are a concise, professional resume-writing assistant. Follow the user's formatting instructions exactly and never add commentary outside what was asked for."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 600
      })
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error("Groq API error:", groqRes.status, errBody);
      return res.status(502).json({ error: "AI provider returned an error" });
    }

    const data = await groqRes.json();
    const text = data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      return res.status(502).json({ error: "Empty response from AI provider" });
    }

    return res.status(200).json({ response: text });
  } catch (err) {
    console.error("AI generate error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
