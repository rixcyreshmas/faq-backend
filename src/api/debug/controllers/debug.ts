import { Context } from "koa";

export default {
  async pgvector(ctx: Context) {
    try {
      const result = await strapi.db.connection.raw(`
        SELECT extname
        FROM pg_extension
        WHERE extname = 'vector';
      `);

      ctx.body = {
        success: true,
        pgvectorEnabled: result.rows.length > 0,
        result: result.rows,
      };
    } catch (error: any) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error.message,
      };
    }
  },
};