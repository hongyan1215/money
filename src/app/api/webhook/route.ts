import { NextRequest, NextResponse } from 'next/server';
import { Client, WebhookEvent, validateSignature, FlexMessage } from '@line/bot-sdk';
import dbConnect from '@/lib/db';
import Transaction from '@/models/Transaction';
import { parseMessage } from '@/lib/ai';
import { getTransactionStats } from '@/lib/stats';
import { generatePieChartUrl } from '@/lib/chart';
import { modifyTransaction } from '@/lib/modify';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const channelSecret = process.env.LINE_CHANNEL_SECRET!;

const client = new Client({
  channelAccessToken,
  channelSecret,
});

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!signature || !validateSignature(body, channelSecret, signature)) {
    return NextResponse.json({ message: 'Invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(body) as { events: WebhookEvent[] };

  await Promise.all(events.map(async (event) => {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const userId = event.source.userId;
    if (!userId) return;

    const userText = event.message.text;
    const replyToken = event.replyToken;

    try {
      await dbConnect();
      
      // 1. AI Intent Classification & Parsing
      const aiResult = await parseMessage(userText);

      // 2. Handle Intent
      switch (aiResult.intent) {
        case 'RECORD':
          if (aiResult.transactions && aiResult.transactions.length > 0) {
            const savedDocs = await Promise.all(aiResult.transactions.map(t => 
              Transaction.create({ userId, ...t, date: new Date(t.date) })
            ));
            
            const summary = savedDocs.map(doc => 
              `${doc.item} $${doc.amount} (${doc.category})`
            ).join('\n');
            
            await client.replyMessage(replyToken, {
              type: 'text',
              text: `已為您記下：\n${summary}`,
            });
          } else {
            await client.replyMessage(replyToken, { type: 'text', text: '抱歉，我不確定您想記什麼。' });
          }
          break;

        case 'QUERY':
          if (aiResult.query) {
            const stats = await getTransactionStats(userId, aiResult.query);
            
            if (stats.transactionCount === 0) {
              await client.replyMessage(replyToken, { type: 'text', text: '該時段沒有任何交易紀錄。' });
              return;
            }

            const chartData = {
              labels: stats.breakdown.map(b => b._id),
              data: stats.breakdown.map(b => b.total)
            };
            const chartUrl = generatePieChartUrl(chartData);
            
            const replyText = `📊 統計結果 (${aiResult.query.startDate.split('T')[0]} ~ ${aiResult.query.endDate.split('T')[0]})\n` +
              `總支出: $${stats.totalExpense}\n` +
              `總收入: $${stats.totalIncome}\n` +
              `交易筆數: ${stats.transactionCount}\n\n` +
              `前三大支出:\n` +
              stats.breakdown.slice(0, 3).map(b => `- ${b._id}: $${b.total}`).join('\n');

            // Send Text + Image if chart is available
            if (chartUrl) {
              await client.replyMessage(replyToken, [
                { type: 'text', text: replyText },
                { 
                  type: 'image', 
                  originalContentUrl: chartUrl, 
                  previewImageUrl: chartUrl 
                }
              ]);
            } else {
              await client.replyMessage(replyToken, { type: 'text', text: replyText });
            }
          }
          break;

        case 'DELETE':
        case 'MODIFY':
          if (aiResult.modification) {
            const resultMsg = await modifyTransaction(userId, aiResult.modification);
            await client.replyMessage(replyToken, { type: 'text', text: resultMsg });
          }
          break;

        case 'UNKNOWN':
        default:
          await client.replyMessage(replyToken, {
            type: 'text',
            text: '抱歉，我不確定您的意思。您可以試著說：「午餐100」、「上週花了多少？」或「刪除上一筆」。',
          });
          break;
      }

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
