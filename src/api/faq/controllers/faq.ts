import { factories } from "@strapi/strapi";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type SessionState = {
  contextJson: Record<string, any>;
  lastQuestion?: string;
  lastAnswer?: string;
  accumulatedKeywords: string[];
  accumulatedUpdates: Record<string, any>[];
  };

const sessionStore = new Map<string, SessionState>();

export default factories.createCoreController("api::faq.faq", ({ strapi }) => ({
  async ask(ctx) {
    const { question, sessionId } = ctx.request.body || {};

    if (!question || !sessionId) {
      ctx.throw(400, "question and sessionId required");
    }

    if (!sessionStore.has(sessionId)) {
      sessionStore.set(sessionId, { contextJson: {},accumulatedKeywords: [], 
    accumulatedUpdates: [], });
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
You are a context extraction engine for a FAQ session.

GOAL: Build a structured JSON context about the user's enquiries.

TASKS:
1. Correct spelling and grammar of the user question WITHOUT changing meaning.
2. Extract important keywords useful for FAQ retrieval.
3. Infer ONLY new information from the current question and return it as updated_json.
4. ALWAYS update "active_enquiry" if the user mentions a new topic, even if the sentence is short (e.g., "Seaplane tour").
5. Check the "Existing JSON" for the highest number n in any enquiry_n field. If the current question is a new topic, 
   you MUST create enquiry_n+1. Example: If enquiry_2 exists, you MUST create enquiry_3
6. If the current question is about a topic already in the history, do NOT create a new enquiry_n.
   Just update active_enquiry to that topic.
RULES:
- JSON keys must be snake_case.
- Return ONLY new or changed fields inside 'updated_json'. 
- If no new information or topic is found (e.g., "Thanks", "Okay", "Tell me more"), updated_json MUST be {}.
- Do NOT remove or reset existing fields.
OUTPUT FORMAT:

{
  "keywords": [],
  "corrected_question": "",
  "updated_json": {
    "active_enquiry": "",
    "enquiry_n": "",
    "details": ...}
}
OUTPUT INSTRUCTIONS:
- Populate keywords with lowercase single words and corrected_question with proper grammar for every input.
- If the topic is new, update active_enquiry and create a new enquiry_n field by 
  incrementing from the highest existing $n$ (e.g., enquiry_3 follows enquiry_2).
- If the user asks a follow-up (e.g., "Explain more") or returns to a previous topic, update active_enquiry 
  but reuse the existing enquiry_n key; do not create a new one.
- If no new information is found, return an empty updated_json: {}.
EXAMPLES:
User question:
"i have 2 kids and a pregnnt wife with me can i book tickets"
Output:
{
  "keywords": ["family", "pregnant", "booking"],
  "corrected_question": "I have two kids and a pregnant wife with me; can I book tickets?",
  "updated_json": {
    "active_enquiry": "family booking",
    "children": 2,
    "pregnant_passenger": true,
    "total_passengers": 4,
    "enquiry_1":"family booking"
} `,
        },
        {
          role: "user",
          content: `
Existing JSON:
${JSON.stringify(session.contextJson)}

Current question:
${question}
          `,
        },
      ],
    });

    const raw = contextBuilder.choices[0].message.content;
    console.log("RAW CONTEXT BUILDER OUTPUT:", raw);

    let extracted: {
      keywords: string[];
      corrected_question: string;
      updated_json: Record<string, any>;
    } = {
      keywords: [],
      corrected_question: question,
      updated_json: {},
    };

    try {
      extracted = JSON.parse(raw);
    } catch {
      console.error("Context JSON parse failed");
    }
 // ACCUMULATE KEYWORDS AND UPDATES

   const currentKeywords = extracted.keywords || [];
const newKeywords = currentKeywords.filter(
  kw => !session.accumulatedKeywords.some(ex => ex.toLowerCase() === kw.toLowerCase())
);
if (newKeywords.length > 0) {
  session.accumulatedKeywords.push(...newKeywords);
}

const incomingUpdates = extracted.updated_json || {};

if (session.accumulatedUpdates.length === 0) {
  session.accumulatedUpdates.push({});
}

const masterState = session.accumulatedUpdates[0];

Object.keys(incomingUpdates).forEach((key) => {
  const newValue = incomingUpdates[key];
  const oldValue = masterState[key];

  if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
    masterState[key] = newValue;
  }
});

const turnDelta = {
  keywords: session.accumulatedKeywords,
  updates: session.accumulatedUpdates[0] 
};

console.log("ACCUMULATED DELTA (Updated):", turnDelta);

    console.log("EXTRACTED CONTEXT:", extracted);
    session.contextJson = {
      ...session.contextJson,
      ...(extracted.updated_json || {}),
    };

const vals = Object.keys(session.contextJson)
  .filter(k => k.startsWith('enquiry_'))
  .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))
  .map(k => session.contextJson[k]);

Object.keys(session.contextJson).forEach(k => k.startsWith('enquiry_') && delete session.contextJson[k]);
vals.slice(-10).forEach((v, i) => session.contextJson[`enquiry_${i + 1}`] = v);
    
// FORCE update if the LLM was lazy but found new keywords
    if (
      extracted.keywords.length > 0 &&
      !extracted.updated_json.active_enquiry
    ) {
      session.contextJson.active_enquiry = extracted.keywords.join(" ");
    }

    console.log("UPDATED SESSION CONTEXT:", session.contextJson);

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: `${extracted.keywords.join(" ")} ${extracted.corrected_question}`,
    });

    const userVector = embeddingResponse.data[0].embedding;
    const knex = strapi.db.connection;

    const userVectorJson = JSON.stringify(userVector);

const results = await knex
  .select("question", "answer", "distance")
  .from(
    knex("faqs")
      .select("question", "answer")
      .select(knex.raw("embedding <=> ?::vector AS distance", [userVectorJson]))
      .whereNotNull("embedding")
      .as("subquery")
  )
  .distinctOn("question")
  .orderBy([
    { column: "question" },
    { column: "distance", order: "asc" }
  ])
  .limit(5);

    const faqs = results.filter((r) => r.distance <= 0.9);

    const faqContext =
      faqs.length > 0
        ? faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")
        : "NO_RELEVANT_FAQS";
    
    ctx.set("Content-Type", "text/event-stream; charset=utf-8");
    ctx.set("Cache-Control", "no-cache");
    ctx.set("Connection", "keep-alive");
    ctx.res.flushHeaders?.();

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      stream: true,
      messages: [
        {
          role: "system",
          content: `
You are a Knowledge-Base Assistant.

ROLE:
Answer user questions using ONLY the provided FAQ context.

CONTEXT SOURCES:
1. FAQ CONTEXT → authoritative source of truth.
2. JSON CONTEXT → describes the user's situation, including:
   - active_enquiry: the current topic the user is asking about
3. JSON CONTEXT -> for preious conversation context:
   - enquiry_1, enquiry_2, etc → past topics discussed in this session.
   - lastQuestion, lastAnswer → previous Q&A in this session helps if the user asks follow up question about previous topic.
 
VALIDATION RULES:

1. SEMANTIC CHECK: Before answering, look at the USER QUESTION. If it is random characters (e.g., "dfghhjh"), a single letter, or nonsensical noise, DO NOT use the Previous Conversation. Instead, ask the user to rephrase.
2. VALID FOLLOW-UPS: If the USER QUESTION is a valid English follow-up (e.g., "Explain more", "Why?", "Details?", "And for kids?", "is it okay?""), and the FAQ CONTEXT is empty, use the PREVIOUS CONVERSATION and FAQ CONTEXT to provide more details based on the PREVIOUS CONVERSATION
3. NO HALLUCINATION: Never invent facts. If the FAQ doesn't have the data, it doesn't exist.

RULES:
- Prefer FAQ CONTEXT whenever relevant information exists.
- JSON CONTEXT helps understand intent but must NEVER block a relevant FAQ answer.
- If FAQ CONTEXT partially answers the question, respond with that information.
- If the user asks follow-up questions and more about the same topic (e.g., "Explain more" ,"Give more details" etc), continue within the same active_enquiry and context.
- If the user switches to a previous topic, check full session json and answer accordingly.
- Do NOT invent facts.
- Do NOT assume missing information.
- If one FAQ doesn't answer everything, use multiple FAQs or your conversation history to piece it together only if relevant.
- Give the answer in 2-3 sentences max whenever possible.
- If FAQ CONTEXT truly contains no relevant information, respond exactly with:
  "I couldn't find this information in our knowledge base."
- Answer clearly, concisely, and in a friendly tone.
- For follow-ups (e.g., "Explain more"), use the PREVIOUS CONVERSATION to maintain context. If the user repeats a question or asks for details, 
  do not repeat yourself verbatim. Instead, cross-reference the JSON CONTEXT (e.g kids, pets, pregnancy) with the FAQ CONTEXT to provide secondary relevant details like boarding priority or baggage rules
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
 
JSON CONTEXT:
${JSON.stringify(session.contextJson)}

USER QUESTION:
${extracted.corrected_question}
          `,
        },
      ],
      max_tokens: 100,
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

    ctx.res.write(`data: [DONE]\n\n`);
    ctx.res.end();

    console.log("Current JSON:", JSON.stringify(session.contextJson, null, 2));
  },
}));
