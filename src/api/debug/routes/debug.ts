export default {
  routes: [
    {
      method: "GET",
      path: "/debug/pgvector",
      handler: "debug.pgvector",
      auth: false,
    },
  ],
};