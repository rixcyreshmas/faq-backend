import React, { useState } from 'react';
import { useFetchClient } from '@strapi/admin/strapi-admin'; 
import { 
  Main, 
  HeaderLayout, 
  ContentLayout, 
  Button, 
  TextInput, 
  Box, 
  Typography 
} from '@strapi/design-system';

export const HomePage = () => {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const { post } = useFetchClient();

  const handleSend = async () => {
    try {
      const { data } = await post('/chat-bot/ask', { query: input });
      setResponse(data.response);
    } catch (error) {
      console.error("Chat Error:", error);
    }
  };

  return (
    <Main>
      <HeaderLayout title="Chat Bot Assistant" subtitle="Decentralized Voting Support" />
      <ContentLayout>
        <Box padding={8} background="neutral0" hasRadius shadow="filterShadow">
          <Typography variant="beta">Ask a Question</Typography>
          <Box marginTop={4}>
            <TextInput 
              placeholder="How do I verify my facial ID?" 
              value={input} 
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)} 
            />
            <Box marginTop={4}>
              <Button onClick={handleSend}>Submit</Button>
            </Box>
          </Box>
          
          {response && (
            <Box marginTop={6} padding={4} background="neutral100" hasRadius>
              <Typography>{response}</Typography>
            </Box>
          )}
        </Box>
      </ContentLayout>
    </Main>
  );
};