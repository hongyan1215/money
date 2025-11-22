import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

if (!process.env.GOOGLE_API_KEY) {
  throw new Error('Missing GOOGLE_API_KEY environment variable');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Define Types
export type IntentType = 'RECORD' | 'QUERY' | 'DELETE' | 'MODIFY' | 'HELP' | 'UNKNOWN';

export interface TransactionData {
  item: string;
  amount: number;
  category: 'Food' | 'Transport' | 'Entertainment' | 'Shopping' | 'Bills' | 'Salary' | 'Other';
  type: 'expense' | 'income';
  date: string; // ISO string
}

export interface QueryData {
  startDate: string; // ISO string
  endDate: string; // ISO string
  category?: string; // Optional filter
  periodType: 'daily' | 'weekly' | 'monthly' | 'custom';
}

export interface ModificationData {
  targetOriginalItem?: string; // To help fuzzy match
  indexOffset?: number; // 0 for last, 1 for second to last...
  action: 'DELETE' | 'UPDATE';
  newItem?: string;
  newAmount?: number;
  newCategory?: string;
}

export interface AIParseResult {
  intent: IntentType;
  transactions?: TransactionData[];
  query?: QueryData;
  modification?: ModificationData;
  message?: string; // For conversational replies if needed
}

const SYSTEM_PROMPT = `
You are a smart accounting assistant. Your job is to understand the user's intent from their natural language message.

Current Reference Time: {{CURRENT_TIME}}

Possible Intents:
1. **RECORD**: The user wants to record a new expense or income.
   - Example: "Lunch 150", "Taxi 300 yesterday", "Salary 50000"
   - Output: Extract transactions array.

2. **QUERY**: The user wants to know about their spending/income stats.
   - Example: "How much did I spend this month?", "Food cost last week?", "Total income today"
   - Output: Extract startDate, endDate, category (optional).
   - Logic: 
     - "This month" -> Start: 1st of current month, End: Current time.
     - "Last month" -> Start: 1st of prev month, End: Last day of prev month.

3. **DELETE/MODIFY**: The user wants to change or remove a previous record.
   - Example: "Delete the last record", "Undo", "Change the last lunch to 200"
   - Output: Identify the action (DELETE/UPDATE) and details.
     - "Undo" usually means delete the most recent transaction (indexOffset: 0).

4. **HELP**: The user is asking what you can do or how to use the bot.
   - Example: "What can you do?", "Help", "Show me features", "指令", "功能"
   - Output: Set intent to HELP.

5. **AUTOFILL RULES**:
   - If 'item' is missing but 'amount' exists, infer 'item' from context or set it to "Unknown Item".
   - If 'amount' is missing, do NOT generate a RECORD transaction.
   - If 'category' is missing, infer it from 'item' or default to "Other".
   - If 'type' is missing, infer from 'category' (e.g. Salary->income, Food->expense) or default to "expense".

Output Schema (JSON):
{
  "intent": "RECORD" | "QUERY" | "DELETE" | "MODIFY" | "HELP" | "UNKNOWN",
  "transactions": [ ... ] (Only if intent is RECORD),
  "query": { "startDate": "...", "endDate": "...", "periodType": "...", "category": "..." } (Only if intent is QUERY),
  "modification": { "action": "...", "indexOffset": 0, "targetOriginalItem": "...", "newAmount": ... } (Only if intent is DELETE/MODIFY)
}

Rules:
- For categories, allowed values: ['Food', 'Transport', 'Entertainment', 'Shopping', 'Bills', 'Salary', 'Other'].
- Dates must be ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ).
- If intent is UNKNOWN, try to explain why in a hypothetical "message" field (though strictly return JSON).
`;

export async function parseMessage(text: string): Promise<AIParseResult> {
  const currentTime = new Date().toISOString();
  const promptWithTime = SYSTEM_PROMPT.replace('{{CURRENT_TIME}}', currentTime);

  // Using gemini-2.5-flash-lite as requested
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: promptWithTime,
    generationConfig: {
      responseMimeType: "application/json",
      // We relax the schema validation slightly to avoid the enum 'format' error, 
      // trusting the prompt to enforce values.
    },
  });

  try {
    const result = await model.generateContent(
      `User Input: "${text}"`
    );
    
    const responseText = result.response.text();
    const parsedResult: AIParseResult = JSON.parse(responseText);
    
    return parsedResult;
  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    // Fallback to UNKNOWN if parsing fails
    return { intent: 'UNKNOWN' };
  }
}
