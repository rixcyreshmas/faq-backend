export default {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'POST',
        path: '/ask',
        handler: 'chatController.ask',
        config: {
          policies: [],
        },
      },
    ],
  },
};
