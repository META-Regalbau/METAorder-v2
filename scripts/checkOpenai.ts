/**
 * Prüft, ob OPENAI_API_KEY für CLI-Skripte erreichbar ist (nicht App-DB).
 *   npx tsx scripts/checkOpenai.ts
 */
import dotenv from "dotenv";
import path from "node:path";
import OpenAI from "openai";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "docker.env") });
dotenv.config();

async function main() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    console.error(
      "Kein OPENAI_API_KEY in der Umgebung.\n" +
        "In den METAorder-Einstellungen hinterlegte Keys gelten für die laufende App, nicht für npx/tsx.\n" +
        "Lege lokal (nicht committen) an: METAorder-v2/.env.local mit einer Zeile:\n" +
        "  OPENAI_API_KEY=sk-...\n"
    );
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: key });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Antworte exakt mit dem Wort: ok" }],
    max_tokens: 8,
    temperature: 0,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text?.toLowerCase().includes("ok")) {
    console.error("Unerwartete Antwort:", text);
    process.exit(1);
  }
  console.log("OpenAI-Check: OK (gpt-4o-mini)");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
