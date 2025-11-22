import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

if (!process.env.GOOGLE_API_KEY) {
  throw new Error('Missing GOOGLE_API_KEY environment variable');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Define Types
export type IntentType = 'RECORD' | 'QUERY' | 'DELETE' | 'MODIFY' | 'HELP' | 'CATEGORY_LIST' | 'LIST_TRANSACTIONS' | 'TOP_EXPENSE' | 'BULK_DELETE' | 'SMALL_TALK' | 'SET_BUDGET' | 'CHECK_BUDGET' | 'DASHBOARD' | 'UNKNOWN';

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

export interface BudgetData {
  category: string; // 'Total' or specific category
  amount: number;
}

export interface AIParseResult {
  intent: IntentType;
  transactions?: TransactionData[];
  query?: QueryData;
  modification?: ModificationData;
  budget?: BudgetData;
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

4. **BULK_DELETE**: The user wants to delete multiple transactions at once.
   - Example: "刪除今天所有交易", "Clear all transactions from last week", "Remove everything from yesterday"
   - Output: Extract startDate, endDate. Set intent to BULK_DELETE.

5. **SMALL_TALK**: The user is engaging in casual conversation or greeting.
   - Example: "Hello", "Hi", "Who are you?", "Good morning", "Thanks", "你是誰", "你好"
   - Output: Set intent to SMALL_TALK. Generate a friendly, context-aware reply in the "message" field.
     - If greeting: "Hello! I'm your AI accounting assistant. Ready to track some expenses?"
     - If thanks: "You're welcome! Let me know if you need anything else."
     - If identity: "I am an AI Smart Accounting Assistant powered by Gemini. I can help you record, track, and analyze your finances."

6. **HELP**: The user is asking what you can do or how to use the bot.
   - Example: "What can you do?", "Help", "Show me features", "指令", "功能"
   - Output: Set intent to HELP.

7. **CATEGORY_QUERY**: The user is asking what spending categories are supported.
   - Example: "有哪些分類？", "What categories?", "分類列表", "種類"
   - Output: Set intent to CATEGORY_LIST.

8. **LIST_TRANSACTIONS**: The user wants to see a detailed list of every single transaction in a period.
   - Example: "請列出上週的每一筆支出", "Show me all transactions from yesterday", "明細"
   - Output: Extract startDate, endDate, category (optional).

9. **TOP_EXPENSE**: The user wants to know which category or item cost the most.
   - Example: "上週哪個種類花費最多？", "What was my biggest expense this month?", "最大筆支出"
   - Output: Extract startDate, endDate.

10. **SET_BUDGET**: The user wants to set a spending limit for a category or overall.
    - Example: "設定餐飲預算 5000", "Set monthly budget 20000", "交通預算 2000"
    - Output: Set intent to SET_BUDGET. Extract category (or 'Total') and amount.
    - Note: If user says "monthly budget", category is "Total".

11. **CHECK_BUDGET**: The user wants to check their budget status.
    - Example: "預算剩多少？", "Check status", "我的預算"
    - Output: Set intent to CHECK_BUDGET.

12. **DASHBOARD**: The user wants to view the web dashboard or backend interface.
    - Example: "Dashboard", "後台", "網頁版", "查看報表", "Web"
    - Output: Set intent to DASHBOARD.

13. **AUTOFILL RULES**:
   - If 'item' is missing but 'amount' exists, infer 'item' from context or set it to "Unknown Item".
   - If 'amount' is missing, do NOT generate a RECORD transaction.
   - If 'category' is missing, infer it from 'item' or default to "Other".
   - If 'type' is missing, infer from 'category' (e.g. Salary->income, Food->expense) or default to "expense".

Output Schema (JSON):
{
  "intent": "RECORD" | "QUERY" | "LIST_TRANSACTIONS" | "TOP_EXPENSE" | "DELETE" | "MODIFY" | "HELP" | "CATEGORY_LIST" | "BULK_DELETE" | "SMALL_TALK" | "SET_BUDGET" | "CHECK_BUDGET" | "DASHBOARD" | "UNKNOWN",
  "transactions": [ ... ] (Only if intent is RECORD),
  "query": { "startDate": "...", "endDate": "...", "periodType": "...", "category": "..." } (Only if intent is QUERY, LIST_TRANSACTIONS, TOP_EXPENSE, BULK_DELETE),
  "modification": { "action": "...", "indexOffset": 0, "targetOriginalItem": "...", "newAmount": ... } (Only if intent is DELETE/MODIFY),
  "budget": { "category": "...", "amount": ... } (Only if intent is SET_BUDGET),
  "message": "..." (Only if intent is SMALL_TALK or UNKNOWN)
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

export async function parseImage(imageBuffer: Buffer, mimeType: string): Promise<AIParseResult> {
  const currentTime = new Date().toISOString();
  const promptWithTime = SYSTEM_PROMPT.replace('{{CURRENT_TIME}}', currentTime);

  // Use a model that supports vision, e.g. gemini-1.5-flash or gemini-2.5-flash-lite
  // Note: As of late 2024/early 2025, check if the lite model supports vision. 
  // If not, fallback to gemini-1.5-flash. We'll stick to 2.5-flash-lite if it works, or 1.5-flash.
  // Safe bet: gemini-1.5-flash is known for vision.
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite", // Assuming lite supports vision, otherwise use "gemini-1.5-flash"
    systemInstruction: promptWithTime,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType: mimeType,
        },
      },
      `Analyze this image.
       If it is a receipt or invoice:
       1. Extract all purchased items, their amounts, and the total date.
       2. Categorize each item according to the allowed categories.
       3. Determine if it's an expense or income (usually expense for receipts).
       4. Return a JSON object with intent "RECORD" and the "transactions" array.
       
       If it is NOT a receipt (e.g. a random photo, a selfie):
       Return a JSON with intent "SMALL_TALK" and a message saying "Nice photo! But I can only read receipts for accounting."
       `
    ]);

    const responseText = result.response.text();
    const parsedResult: AIParseResult = JSON.parse(responseText);
    
    return parsedResult;
  } catch (error) {
    console.error('Failed to parse Gemini vision response:', error);
    return { intent: 'UNKNOWN' };
  }
}
