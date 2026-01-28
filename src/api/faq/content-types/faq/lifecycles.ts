import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
async function generateEmbedding(text: string) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
    console.log(":white_check_mark: Embedding generated successfully.", response.data[0].embedding);
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    return null;
  }
}

async function saveVectorToDB(id: number, text: string) {
  try {
    const embeddingVector = await generateEmbedding(text);
    if (!embeddingVector) return;
    const updateResult = await strapi.db.connection('faqs')
      .where({ id: id })
      .update({
        embedding: strapi.db.connection.raw('?::vector', [JSON.stringify(embeddingVector)])
      });
    console.log(`:white_check_mark: [Async] Embedding saved for ID: ${id}. Rows updated: ${updateResult}`);
  } catch (err) {
    console.error(`:x: [Async] Failed to save vector for ID ${id}`, err);
  }
}
export default {
  async afterCreate(event) {
    const { result } = event;
    const textToEmbed = `Q: ${result.question} \n A: ${result.answer}`;

    setTimeout(() => {
      saveVectorToDB(result.id, textToEmbed);
    }, 1000);
    console.log("Question:", result.question);
    console.log("Answer:", result.answer);
  },

  async afterUpdate(event) {
    const { result } = event;
    const textToEmbed = `Q: ${result.question} \n A: ${result.answer}`;
    setTimeout(() => {
      saveVectorToDB(result.id, textToEmbed);
    }, 1000);
    console.log(result.id ? `:arrows_counterclockwise: FAQ ID ${result.id} updated. Scheduling embedding regeneration.` : ':warning: FAQ updated, but no ID found.');
    console.log("Question",result.question);
    console.log("Answer",result.amswer);
  },

  async afterDelete(event) {
    console.log(`:wastebasket: FAQ ID ${event.result.id} deleted.`);
  },
};