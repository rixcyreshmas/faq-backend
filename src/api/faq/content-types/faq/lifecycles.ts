import OpenAI from 'openai';
import { text } from 'stream/consumers';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
function cleanText(input: string) {
  let text = input;
  //headings
  text = text.replace(/^#+\s+/gm, '');
  //bold, italic, underline, strikethrough
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  text = text.replace(/<u>(.*?)<\/u>/g, '$1');
  //lists
  text = text.replace(/^\s*[-*]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  //blockquotes
  text = text.replace(/^>\s+/gm, '');
  //code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  //links
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  //multiple spaces / newlines
  text = text.replace(/\n{2,}/g, '\n');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}
async function generateEmbedding(text: string) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
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
    console.log(`Embedding saved for ID: ${id}. Rows updated: ${updateResult}`);
  } catch (err) {
    console.error(`Failed to save vector for ID ${id}`, err);
  }
}
async function processFAQEmbedding(result: any) {
    console.log(`Original Answer: ${result.answer}`);
  const textToEmbed = `Q: ${result.question}\nA: ${cleanText(result.answer)}`;
  setTimeout(() => {
    saveVectorToDB(result.id, textToEmbed);
    console.log(`Processing embedding for FAQ ID: ${textToEmbed}`);
  }, 1000);
}
export default {
  async afterCreate(event) {
    await processFAQEmbedding(event.result);
  },
  async afterUpdate(event) {
    await processFAQEmbedding(event.result);
  },
  async afterDelete(event) {
    console.log(`FAQ ID ${event.result.id} deleted.`);
  }
};