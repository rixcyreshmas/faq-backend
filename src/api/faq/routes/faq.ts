import { factories } from '@strapi/strapi';
const coreRouter: any = factories.createCoreRouter('api::faq.faq');
const customRoute = {
  method: 'POST',
  path: '/faq/chatbot',
  handler: 'faq.chatbot',
  config: { auth: false },
};
export default () => {
  const baseRoutes =
    typeof coreRouter === 'function'
        ? coreRouter().routes
        : coreRouter.routes;
  return {
    routes: [...baseRoutes, customRoute],
  };
};