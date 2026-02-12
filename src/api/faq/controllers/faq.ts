import { factories } from "@strapi/strapi";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type SessionState = {
  contextJson: Record<string, any>;
  accumulatedKeywords: string[];
  lastQuestion?: string;
  lastAnswer?: string;
};

const sessionStore = new Map<string, SessionState>();

function normalizeEmbedding(value: unknown): number[] | null {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "number")
  ) {
    return value;
  }
  return null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// const results = await knex("faqs")
//       .select(
//         "question",
//         "answer",
//         knex.raw("embedding <=> ?::vector AS distance", [JSON.stringify(userVector)])
//       )
//       .whereNotNull("embedding")
//       .orderBy("distance")
//       .limit(5);

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export default factories.createCoreController("api::faq.faq", ({ strapi }) => ({
  async ask(ctx) {
    const { question, sessionId } = ctx.request.body || {};

    if (!question || !sessionId) {
      ctx.throw(400, "question and sessionId are required");
    }

    if (!sessionStore.has(sessionId)) {
      sessionStore.set(sessionId, {
        contextJson: {},
        accumulatedKeywords: [],
      });
    }

    const session = sessionStore.get(sessionId)!;

    const contextBuilder = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
          INSTRUCTIONS

          I. FOR faq_context function:

          USER CONTEXT:
          - Known Facts: ${JSON.stringify(session.contextJson)}
          - Previous Keywords: ${JSON.stringify(session.accumulatedKeywords)}

        TASK PRIORITY for faq_context function:
          1. Extract and update contextUpdates with latest facts.
          2. If the user mentions '2 kids', you MUST set { example: "child_count": 2 etc} in updated_json likewise render all the info and update it in updated_json.
          3. Correct spelling and grammar of the user question WITHOUT changing meaning and return corrected question
          4. Check the "Existing JSON" for the highest number n in any enquiry_n field. If the current question is a new topic, 
             you MUST create enquiry_n+1. Example: If enquiry_2 exists, you MUST create enquiry_3
          5. If the current question is about a topic already in the history, do NOT create a new enquiry_n.Just update active_enquiry to that topic.

        OUTPUT INSTRUCTIONS:
        - Populate important keywords with lowercase single words and corrected_question with proper grammar for every input.
        - Personal or situational facts MUST ALWAYS be extracted into updated_json.
        - active_enquiry MUST be a short intent phrase.
        
        PERSONAL CONTEXT EXTRACTION RULES:
          - ANY personal information mentioned MUST go into contextJson
          - Examples:
            * "I have 2 kids" → {"child_count": 2}
            * "traveling to Tokyo" → {"traveling_to": "Tokyo"}
            * "my budget is $1000" → {"budget": 1000}
            * "I prefer vegetarian food" → {"dietary_preference": "vegetarian"}
            * "next Friday" → {"mentioned_date": "next Friday"}

        NUMERICAL UPDATES:
          - If context shows {child_count: 2} and user says "I have 1 more kid" → {"child_count": 3}
          - If user corrects "actually 3 kids" → {"child_count": 3}
          - If user says "total 4 kids" → {"child_count": 4}
           OUTPUT FORMAT:
            {
            "keywords": [],
            "corrected_question": "",
            "updated_json": {
            "active_enquiry": "",
            "enquiry_1": "",}
            }
            `,
        },
        {
          role: "user",
          content: `
            Existing JSON:
            ${JSON.stringify(session.contextJson)}

            User question:
            ${question}
            `,
        },
      ],
    });

    let extracted = {
      keywords: [] as string[],
      corrected_question: question,
      updated_json: {} as Record<string, any>,
    };

    try {
      const parsed = JSON.parse(contextBuilder.choices[0].message.content!);

      extracted = {
        keywords: parsed.keywords ?? [],
        corrected_question: parsed.corrected_question ?? question,
        updated_json: parsed.updated_json ?? {},
      };
    } catch {
      console.error("❌ Context JSON parse failed");
    }

    console.log("Extracted Value",extracted);

    session.contextJson = {
      ...session.contextJson,
      ...extracted.updated_json,
    };

    const mergedKeywords = [
      ...new Set([...session.accumulatedKeywords, ...extracted.keywords]),
    ];
    session.accumulatedKeywords = mergedKeywords;

    const embeddingInput = `
      Q: ${extracted.corrected_question}
      Active Enquiry: ${session.contextJson.active_enquiry || ""}
      Keywords: ${extracted.keywords.join(", ")}
      `.trim();

    console.log(" EMBEDDING INPUT:", embeddingInput);

    const userVector = await generateEmbedding(embeddingInput);
    console.log(" USER VECTOR DIMENSION:", userVector.length);

    const faqs = await strapi.entityService.findMany("api::faq.faq", {
      fields: ["question", "answer", "embedding"],
      publicationState: "live",
      limit: -1,
    });

    console.log(" TOTAL FAQ COUNT:", faqs.length);

    const scoredFaqs = faqs
      .map((faq) => {
        const embedding = normalizeEmbedding(faq.embedding);
        if (!embedding) return null;

        if (embedding.length !== userVector.length) {
          console.log("❌ DIMENSION MISMATCH:", faq.question, embedding.length);
          return null;
        }

        return {
          question: faq.question!,
          answer: faq.answer!,
          score: cosineSimilarity(userVector, embedding),
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    console.log(" TOP 5 FAQ SCORES:");
    console.log(scoredFaqs);

    const faqContext =
      scoredFaqs.length > 0
        ? scoredFaqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")
        : "NO_RELEVANT_FAQS";

    // console.log(" FAQ CONTEXT:");
    // console.log(faqContext);

    ctx.set("Content-Type", "text/event-stream");
    ctx.set("Cache-Control", "no-cache");
    ctx.set("Connection", "keep-alive");
    ctx.res.flushHeaders?.();

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: `
          
          INSTRUCTIONS:
          -End your response with a complete sentence. Before finishing, verify the final character is a period.

          You ARE allowed to:
          - Combine information from multiple FAQ entries
          - Rephrase policies into a direct answer
          - Give conditional guidance (e.g., "you may book if...", "you should check...")

          You are NOT allowed to:
          - Add information not present in the FAQ CONTEXT
          - Use external knowledge
          
          ONLY respond with:
          "I couldn't find this information in our knowledge base."
          IF AND ONLY IF:
          - FAQ CONTEXT is "NO_RELEVANT_FAQS"

            `,
        },
        {
          role: "user",
          content: `            
            FAQ CONTEXT:
              ${faqContext}

            PREVIOUS CONVERSATION:
            User: ${session.lastQuestion || "None"}
            Assistant: ${session.lastAnswer || "None"}

            JSON CONTEXT:${JSON.stringify(session.contextJson)}
            CURRENT QUESTION:${extracted.corrected_question}
            `,
        },
      ],
    });

    let fullAnswer = "";

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (!token) continue;

      fullAnswer += token;
      ctx.res.write(`data:${token}\n\n`);
    }

    session.lastQuestion = question;
    session.lastAnswer = fullAnswer;

    ctx.res.write("data: [DONE]\n\n");
    ctx.res.end();
  },
}));
