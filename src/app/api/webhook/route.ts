import { NextRequest, NextResponse } from 'next/server';
import { Client, WebhookEvent, validateSignature, TextMessage } from '@line/bot-sdk';
import dbConnect from '@/lib/db';
import Transaction from '@/models/Transaction';
import { parseTransaction } from '@/lib/ai';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const channelSecret = process.env.LINE_CHANNEL_SECRET!;

const client = new Client({
  channelAccessToken,
  channelSecret,
});

export async function POST(req: NextRequest) {
  // 1. Validate Signature
  const body = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!signature || !validateSignature(body, channelSecret, signature)) {
    return NextResponse.json({ message: 'Invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(body) as { events: WebhookEvent[] };

  // 2. Process Events
  await Promise.all(events.map(async (event) => {
    if (event.type !== 'message' || event.message.type !== 'text') {
      return;
    }

    const userId = event.source.userId;
    if (!userId) return;

    const userText = event.message.text;
    const replyToken = event.replyToken;

    try {
      // Connect to DB
      await dbConnect();

      // AI Parse
      // Notify user processing is happening (optional, but good UX if slow)
      // For now, we just wait.
      
      const transactions = await parseTransaction(userText);

      if (transactions.length === 0) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '抱歉，我無法理解您的記帳內容。請試著說：「午餐 100」',
        });
        return;
      }

      // Save to DB
      const savedDocs = await Promise.all(transactions.map(async (t) => {
        return Transaction.create({
          userId,
          ...t,
          date: new Date(t.date),
        });
      }));

      // Format Reply
      const summary = savedDocs.map(doc => {
        const dateStr = new Date(doc.date).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
        return `${doc.item} $${doc.amount} (${doc.category})`;
      }).join('\n');

      const replyText = `已為您記下：\n${summary}`;

      await client.replyMessage(replyToken, {
        type: 'text',
        text: replyText,
      });

    } catch (error) {
      console.error('Error processing event:', error);
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '系統發生錯誤，請稍後再試。',
      });
    }
  }));

  return NextResponse.json({ status: 'ok' });
}

