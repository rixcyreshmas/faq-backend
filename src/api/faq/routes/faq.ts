export default {
  routes: [
    {
      method: "POST",
      path: "/faqs/ask",
      handler: "faq.ask",
      config: {
        auth: false,
      },
    },
  ],
};