import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateEmbedding(text: string) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    return null;
  }
}

export default {
  async beforeCreate(event) {
    const { data } = event.params;

    if (!data.question || !data.answer) return;

    const textToEmbed = `Q: ${data.question}\nA: ${data.answer}`;
    const embedding = await generateEmbedding(textToEmbed);

    if (embedding) {
      data.embedding = embedding; 
    }
  },

async beforeUpdate(event) {
  const { where, data } = event.params;

  const existingEntry = await strapi
    .documents(event.model.uid)
    .findOne({ documentId: where.id });

  const question = data.question ?? existingEntry?.question;
  const answer = data.answer ?? existingEntry?.answer;

  if (!question || !answer) return;

  const textToEmbed = `Q: ${question}\nA: ${answer}`;
  const embedding = await generateEmbedding(textToEmbed);

  if (embedding) {
    data.embedding = embedding;
  }
}
,
};
