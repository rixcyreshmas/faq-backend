export default {
  async ask(ctx) {
    const { query } = ctx.request.body;

    if (!query) {
      return ctx.badRequest('Query is required');
    }

    const reply = await strapi
      .plugin('chat-bot')
      .service('chatService')
      .generateResponse(query);

    await strapi.documents('plugin::chat-bot.chat-log').create({
      data: {
        user_query: query,
        bot_response: reply,
        timestamp: new Date(),
      },
    });

    ctx.body = { response: reply };
  },
};
