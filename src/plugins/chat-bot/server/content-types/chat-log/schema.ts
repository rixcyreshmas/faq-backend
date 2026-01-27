export default {
  kind: 'collectionType',
  collectionName: 'chat_logs',
  info: {
    singularName: 'chat-log',
    pluralName: 'chat-logs',
    displayName: 'Chat Log',
  },
  options: {
    draftAndPublish: false,
  },
  attributes: {
    user_query: {
      type: 'text',
      required: true,
    },
    bot_response: {
      type: 'text',
    },
    timestamp: {
      type: 'datetime',
    },
  },
};
