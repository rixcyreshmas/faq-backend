import type { Core } from '@strapi/strapi';

const bootstrap = ({ strapi }: { strapi: Core.Strapi }) => {
  console.log('🚀 --- DEBUG: CHAT-BOT PLUGIN BOOTSTRAP ---');
  
  // This lists every content-type Strapi has registered
  const contentTypes = Object.keys(strapi.contentTypes);
  const pluginModels = contentTypes.filter(key => key.includes('chat-bot'));

  if (pluginModels.length === 0) {
    console.log('❌ No models found for chat-bot. Check server/src/index.ts exports.');
  } else {
    console.log('✅ Found Chat-Bot models:', pluginModels);
  }
};

export default bootstrap;