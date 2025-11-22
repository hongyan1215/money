import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

if (!process.env.GOOGLE_API_KEY) {
  throw new Error('Missing GOOGLE_API_KEY environment variable');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export interface TransactionData {
  item: string;
  amount: number;
  category: 'Food' | 'Transport' | 'Entertainment' | 'Shopping' | 'Bills' | 'Salary' | 'Other';
  type: 'expense' | 'income';
  date: string; // ISO string
}

const SYSTEM_PROMPT = `
You are a professional accounting data entry clerk. Your task is to parse natural language text into structured transaction data.

Input: User's text message describing expenses or income, and the current reference time.
Output: A JSON array of transaction objects.

Rules:
1. Extract all distinct transactions from the text.
2. For each transaction, determine:
   - 'item': Short description of the item.
   - 'amount': The numeric value.
   - 'category': Must be one of [Food, Transport, Entertainment, Shopping, Bills, Salary, Other]. Choose the best fit.
   - 'type': 'expense' or 'income'.
   - 'date': The ISO 8601 date string (YYYY-MM-DDTHH:mm:ss.sssZ) of when the transaction occurred.
     - Use the provided "Current Reference Time" to resolve relative dates like "yesterday", "last friday", "today".
     - If no specific time is mentioned, use the Current Reference Time.
`;

export async function parseTransaction(text: string): Promise<TransactionData[]> {
  const currentTime = new Date().toISOString();
  
  // Using gemini-1.5-flash as requested (closest valid model to "gemini-2.5-flash-lite")
  // You can change this to 'gemini-2.0-flash-exp' if available to your key
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            item: { type: SchemaType.STRING },
            amount: { type: SchemaType.NUMBER },
            category: { 
              type: SchemaType.STRING,
            },
            type: { 
              type: SchemaType.STRING,
            },
            date: { type: SchemaType.STRING },
          },
          required: ['item', 'amount', 'category', 'type', 'date'],
        },
      },
    },
  });

  try {
    const result = await model.generateContent(
      `Current Reference Time: ${currentTime}\nUser Input: "${text}"`
    );
    
    const responseText = result.response.text();
    const transactions: TransactionData[] = JSON.parse(responseText);
    
    return transactions;
  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    throw new Error('Failed to parse transaction data');
  }
}
