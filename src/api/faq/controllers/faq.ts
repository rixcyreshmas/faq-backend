import { factories } from '@strapi/strapi';
import OpenAI from 'openai';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
export default factories.createCoreController('api::faq.faq', ({ strapi }) => ({
  async chatbot(ctx) {
    console.log('--- [CHATBOT] REQUEST START ---');
    const { question, context = {} } = ctx.request.body; 
    console.log('Question received:', question);
    console.log('Context received:', JSON.stringify(context, null, 2));
    if (!question) {
      console.error('Error: No question provided');
      ctx.throw(400, 'Question is required');
    }
    const availableCollections = [
      { 
        name: 'flight-data', 
        fields: ['airline', 'arrival', 'departure', 'price'] 
      },
      { 
        name: 'hotels', 
        fields: ['name', 'location', 'cost'] 
      },
      { 
        name: 'bookings', 
        fields: ['booking_id', 'customer_id', 'status'] 
      },
    ];
    const collectionsSchemaText = availableCollections
      .map((c) => `Collection: ${c.name}\nFields: ${c.fields.join(', ')}`)
      .join('\n\n');
    const samples = await Promise.all(availableCollections.map(async (c) => {
        try {
          const uid = `api::${c.name}.${c.name}`;
          const data = await strapi.entityService.findMany(uid as any, { 
            limit: 5,
            fields: c.fields 
          });
          return `Actual data format for ${c.name}: ${JSON.stringify(data)}`;
        } catch (e) {
          return `(No data available for ${c.name})`;
        }
      })
    ); 
    const samplesText = samples.join('\n\n');
    const tools: ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "context_builder",
          description: "Analyze user question and determine intent. Extract keywords, update context, and detect if realtime data is needed.",
          parameters: {
            type: "object",
            properties: {
              intent: { 
                type: "string", 
                enum: ["faq", "general", "realtime"],
                description: "Intent classification: 'faq' for FAQ questions, 'general' for conversational questions, 'realtime' for live database queries" 
              },
              keywords: { 
                type: "array", 
                items: { type: "string" }, 
                description: "3-5 key terms for search (especially important for faq intent)." 
              },
              contextUpdates: { 
                type: "object", 
                description: "DATA EXTRACTION REQUIRED: Identify any entities, quantities, or conditions. " +
                             "This field MUST NOT be empty if the user mentions personal details.",
                properties: {
                  extracted_fact: { 
                    type: "string", 
                    description: "A summary of the most important fact found." 
                  }
                },
                additionalProperties: true,
                required: ["extracted_fact"]
              },
              correctedQuestion: { 
                type: "string", 
                description: "A spelling and grammar corrected version of the user's question." 
              },
              enquiryTopic: { 
                type: "string", 
                description: "Main topic of enquiry for history tracking." 
              }
            },
            required: ["intent", "keywords", "contextUpdates", "correctedQuestion"]
          }
        }
      }
    ];
    console.log(`Sample data reference: ${samplesText}`);
    // Step 1: Intent classification and context building
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an intent classifier and context builder. Analyze the user's question and:
          INSTRUCTIONS:
          1. Determine intent:
             - 'faq': Questions about policies, procedures, help, how-to, what-is, informational questions
             - 'general': Conversational, greetings, thanks, casual questions, follow-ups
             - 'realtime': Questions requiring current/live data from database, queries about flights, hotels, bookings
          2. Extract context:
             - Always update contextUpdates with any personal details
             - If user mentions numbers (like '2 kids'), add to context (e.g., {"child_count": 2})
             - Correct spelling/grammar in correctedQuestion
          3. For realtime intent:
             - User wants to query database for current information
             - Questions like "show me flights to Paris", "find hotels in London"
          USER CONTEXT:
          - Past Enquiries: ${JSON.stringify(context.enquiryHistory || [])}
          - Known Facts: ${JSON.stringify(context.contextJson || {})}
          - Previous Keywords: ${JSON.stringify(context.keywords || [])}
          DATABASE REFERENCE (actual fields and values):
          ${samplesText}
          
          Available Collections:
          ${collectionsSchemaText}
          `
        },
        { 
          role: 'user',
          content: `CURRENT QUESTION: ${question}` 
        }
      ],
      tools,
      tool_choice: { type: "function", function: { name: "context_builder" } },
    });
    const toolCalls = response.choices[0].message.tool_calls || [];
    if (toolCalls.length === 0) {
      ctx.throw(400, 'AI did not select any action');
    }
    console.log(`Tool calls detected: ${toolCalls.length}`);
    let updatedContext = { ...context };
    let intent = '';
    let keywords = [];
    let correctedQuestion = '';
    let enquiryTopic = '';
    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function' && toolCall.function.name === 'context_builder') {
        const args = JSON.parse(toolCall.function.arguments);
        const { 
          intent: detectedIntent, 
          keywords: extractedKeywords = [], 
          contextUpdates = {}, 
          correctedQuestion: corrected,
          enquiryTopic: topic
        } = args;
        intent = detectedIntent;
        keywords = extractedKeywords;
        correctedQuestion = corrected;
        enquiryTopic = topic;
        
        console.log('--- [AI TOOL OUTPUT] ---');
        console.log('Intent:', intent);
        console.log('Keywords:', keywords);
        console.log('Topic:', enquiryTopic);
        console.log('Corrected Question:', correctedQuestion);
        console.log('Context Updates:', contextUpdates);
        // Update user context
        const MAX_HISTORY = 10;
        const existingKeywords = Array.isArray(updatedContext.keywords) ? updatedContext.keywords : [];
        const mergedKeywords = [...new Set([...existingKeywords, ...keywords])];
        let enquiryHistory = Array.isArray(updatedContext.enquiryHistory) ? [...updatedContext.enquiryHistory] : [];
        
        if (enquiryTopic && enquiryHistory[enquiryHistory.length - 1] !== enquiryTopic) {
            enquiryHistory.push(enquiryTopic);
        }
        
        if (enquiryHistory.length > MAX_HISTORY) {
            enquiryHistory.shift();
        }
        const existingContextJson = updatedContext.contextJson || {};
        const updatedContextJson = {
            ...existingContextJson,
            ...contextUpdates 
        };
        updatedContext = {
            ...updatedContext,
            keywords: mergedKeywords,
            correctedQuestion: correctedQuestion,
            enquiryHistory: enquiryHistory,
            contextJson: updatedContextJson,
            lastIntent: intent
        };
        console.log('--- [UPDATED USER CONTEXT] ---');
        console.log("Keywords:", updatedContext.keywords);
        console.log("History:", updatedContext.enquiryHistory);
        console.log("Context Json:", JSON.stringify(updatedContext.contextJson, null, 2));
        console.log("Intent:", intent);
        break;
      }
    }
    // Set up SSE response headers
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.status = 200;
    
    // Flush headers
    if (ctx.res.flushHeaders) {
      ctx.res.flushHeaders();
    }
    // Send context update first
    ctx.res.write(`data: ${JSON.stringify({ type: 'context', context: updatedContext })}\n\n`);
    if (intent === 'faq') {
      console.log('--- PROCESSING FAQ INTENT ---');
      
      const finalQuestion = [correctedQuestion || question, ...keywords].join(' ');
      
      try {
        const embeddingRes = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: finalQuestion,
        });
        const queryVector = embeddingRes.data[0].embedding;
        // Vector search in FAQ table
        const faqs = await strapi.db.connection('faqs')
          .select('question', 'answer')
          .whereNotNull('published_at')
          .orderByRaw(`embedding <-> ?::vector`, [JSON.stringify(queryVector)])
          .limit(3);
        console.log('FAQ search results:', faqs.length);
        // Prepare FAQ context
        const faqContextXml = faqs.length > 0 
          ? faqs.map(f => `<faq><question>${f.question}</question><answer>${f.answer}</answer></faq>`).join('\n')
          : "No matching FAQ found.";
        // Get conversation history for context
        const conversationHistory = updatedContext.enquiryHistory?.slice(-2) || [];
        const userContext = updatedContext.contextJson || {};
        
        // Generate answer using FAQ context and conversation history
        const stream = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are a helpful FAQ assistant. Answer questions using ONLY the FAQ context provided.
                     
                     USER CONTEXT:
                     ${JSON.stringify(userContext)}
                     
                     CONVERSATION HISTORY:
                     ${conversationHistory.join(' | ')}
                     
                     RULES:
                     1. If the FAQ context has the answer, use it
                     2. Be concise and helpful
                     3. If FAQ doesn't have answer, say "I don't have information about that in our FAQs"
                     4. Don't make up information` 
            },
            { 
              role: 'user', 
              content: `<faq_context>
                      ${faqContextXml}
                      </faq_context>
                      User Question: ${finalQuestion}
                      Please answer based on the FAQ context above.` 
            }
          ],
          stream: true,
        });
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            ctx.res.write(`data: ${JSON.stringify({ type: 'chunk', content: content })}\n\n`);
          }
        }
      } catch (error) {
        console.error('FAQ processing error:', error);
        ctx.res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to process FAQ request' })}\n\n`);
      }
    } else if (intent === 'realtime') {
      console.log('--- PROCESSING REALTIME INTENT ---');
      try {
        const queryResponse = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are a database query builder. Based on the user's question, output a JSON object for database querying.
                      AVAILABLE COLLECTIONS:
                      ${collectionsSchemaText}
                      
                      DATABASE SAMPLES:
                      ${samplesText}
                      
                      USER CONTEXT:
                      ${JSON.stringify(updatedContext.contextJson || {})}
                      TASK:
                      1. Choose the most relevant collection from the above available collections
                      2. Create filters based on the user's question
                      3. Specify sort for queries needing ordering (like next, cheapest, earliest)
                      4. Use the samples to understand actual field names and values and use that values, don't believe on user input directly
                      5. Return ONLY a JSON object with this exact structure:
                      {
                        "collection": "collection-name",
                        "filters": {},
                        "sort": {}
                      }
                      RULES:
                      - Use strapi operators like $lte, $gte, $containsi
                      - Use $or for comparisons only(this or that)
                      - For text searches in filters, use: {"field_name": {"$containsi": "search_term"}}
                      - For number comparisons: {"price": {"$lte": Y}}
                      - Use "asc" or "desc" for sort if needed
                      EXAMPLES:
                      {
                        "collection": "fcollection-name",
                        "filters": {
                          "field1": {"$containsi": "X"},
                          "field2": {"$lte": Y}
                        },
                        "sort": {"field2": "asc"}
                      }
                      Return ONLY JSON. No explanations.` 
            },
            { 
              role: 'user', 
              content: `Question: ${correctedQuestion || question}` 
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });
        const queryData = JSON.parse(queryResponse.choices[0].message.content || '{}');
        const { collection, filters = {}, sort = {} } = queryData;
        console.log('AI Generated Query:', JSON.stringify(queryData, null, 2));
        if (!collection) {
          ctx.res.write(`data: ${JSON.stringify({ type: 'error', message: 'No collection specified for realtime query' })}\n\n`);
          ctx.res.write('data: [DONE]\n\n');
          ctx.res.end();
          return;
        }
        const uid = `api::${collection}.${collection}`;
        console.log(`Querying collection: ${uid}`);
        console.log(`Filters:`, JSON.stringify(filters));
        console.log(`Sort:`, JSON.stringify(sort));
        const data = await strapi.entityService.findMany(uid as any, {
          filters,
          sort,
          limit: 10,
        });
        console.log('Realtime results returned:', data);
        
        // Simplify the data for frontend display
        const simplifiedData = data.map((item: any) => {
          const { id, ...rest } = item;
          return rest;
        });
        
        ctx.res.write(`data: ${JSON.stringify({ 
          type: 'realtime_data', 
          collection,
          data: simplifiedData 
        })}\n\n`);
      } catch (err: any) {
        console.error(`[STRAPI] Query Error:`, err);
        ctx.res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: `Database query failed: ${err.message}` 
        })}\n\n`);
      }
    } else if (intent === 'general') {
      console.log('--- PROCESSING GENERAL INTENT ---');
      
      try {
        // General path: Direct to AI without embeddings
        const finalQuestion = correctedQuestion || question;
        
        // Get conversation history for context
        const conversationHistory = updatedContext.enquiryHistory?.slice(-2) || [];
        const userContext = updatedContext.contextJson || {};
        
        const stream = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are a friendly and helpful assistant.
                     
                     USER CONTEXT:
                     ${JSON.stringify(userContext)}
                     
                     RECENT CONVERSATION:
                     ${conversationHistory.join(' | ')}
                     
                     Be conversational, helpful, and keep responses concise.
                     ` 
            },
            { 
              role: 'user', 
              content: finalQuestion 
            }
          ],
          stream: true,
        });
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            ctx.res.write(`data: ${JSON.stringify({ type: 'chunk', content: content })}\n\n`);
          }
        }
      } catch (error) {
        console.error('General intent error:', error);
        ctx.res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to process general request' })}\n\n`);
      }
    }
    // End stream
    ctx.res.write('data: [DONE]\n\n');
    ctx.res.end();
  },
}));
