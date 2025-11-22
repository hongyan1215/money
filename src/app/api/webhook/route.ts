import { NextRequest, NextResponse } from 'next/server';
import { Client, WebhookEvent, validateSignature, FlexMessage } from '@line/bot-sdk';
import dbConnect from '@/lib/db';
import Transaction from '@/models/Transaction';
import { parseMessage, parseImage } from '@/lib/ai';
import { getTransactionStats, getTransactionList, getTopExpense } from '@/lib/stats';
import { generatePieChartUrl } from '@/lib/chart';
import { modifyTransaction, bulkDeleteTransactions } from '@/lib/modify';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const channelSecret = process.env.LINE_CHANNEL_SECRET!;

const client = new Client({
  channelAccessToken,
  channelSecret,
});

// Helper function to check for duplicate transactions
async function checkDuplicateTransaction(
  userId: string,
  transaction: { item: string; amount: number; category: string; type: string; date: Date }
): Promise<boolean> {
  // Check for duplicates within the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  const duplicate = await Transaction.findOne({
    userId,
    item: transaction.item,
    amount: transaction.amount,
    category: transaction.category,
    type: transaction.type,
    date: {
      $gte: fiveMinutesAgo,
      $lte: new Date()
    }
  });

  return !!duplicate;
}

// Track processed image message IDs to prevent duplicate OCR processing
const processedImageIds = new Set<string>();
const IMAGE_ID_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up old image IDs periodically
setInterval(() => {
  // In a production environment, you might want to use Redis or a database
  // For now, we'll just clear the set periodically (this is a simple in-memory solution)
  if (processedImageIds.size > 1000) {
    processedImageIds.clear();
  }
}, 10 * 60 * 1000); // Every 10 minutes

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!signature || !validateSignature(body, channelSecret, signature)) {
    return NextResponse.json({ message: 'Invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(body) as { events: WebhookEvent[] };

  await Promise.all(events.map(async (event) => {
    // Handle Message Events
    if (event.type === 'message') {
      const userId = event.source.userId;
      if (!userId) return;
      const replyToken = event.replyToken;

      try {
        await dbConnect();
        
        let aiResult;

        // 1. Handle Text Message
        if (event.message.type === 'text') {
          const userText = event.message.text;
          aiResult = await parseMessage(userText);
        } 
        // 2. Handle Image Message (OCR)
        else if (event.message.type === 'image') {
          // Check if this image has already been processed
          const imageId = event.message.id;
          if (processedImageIds.has(imageId)) {
            await client.replyMessage(replyToken, { 
              type: 'text', 
              text: '這張圖片已經處理過了，不會重複記錄。' 
            });
            return;
          }

          // Get image content
          const stream = await client.getMessageContent(imageId);
          const buffers: Uint8Array[] = [];
          for await (const chunk of stream) {
            buffers.push(chunk);
          }
          const buffer = Buffer.concat(buffers);
          
          // Pass to AI
          aiResult = await parseImage(buffer, 'image/jpeg'); // Line images are typically JPEG
          
          // Mark this image as processed
          processedImageIds.add(imageId);
          
          // Remove from cache after TTL (simple timeout)
          setTimeout(() => {
            processedImageIds.delete(imageId);
          }, IMAGE_ID_CACHE_TTL);
        } else {
          // Ignore other message types
          return;
        }

        // 3. Handle Intent (Shared logic for both Text and Image)
        switch (aiResult.intent) {
          case 'RECORD':
            if (aiResult.transactions && aiResult.transactions.length > 0) {
              // Validation: Filter out invalid transactions
              const validTransactions = aiResult.transactions.filter(t => t.item && t.amount && t.category && t.type);

              if (validTransactions.length === 0) {
                await client.replyMessage(replyToken, { type: 'text', text: '抱歉，我無法識別有效的記帳內容。請確保包含項目與金額。' });
                break;
              }

              // Check for duplicates and filter them out
              const transactionsToSave = [];
              const duplicateItems: string[] = [];

              for (const t of validTransactions) {
                // Robust Date Parsing: If AI date is invalid, fallback to NOW
                let dateObj = new Date(t.date);
                if (isNaN(dateObj.getTime())) {
                  console.warn(`Invalid date received from AI: ${t.date}, falling back to current time.`);
                  dateObj = new Date();
                }

                const transactionData = {
                  item: t.item,
                  amount: t.amount,
                  category: t.category,
                  type: t.type,
                  date: dateObj
                };

                // Check for duplicates
                const isDuplicate = await checkDuplicateTransaction(userId, transactionData);
                if (isDuplicate) {
                  duplicateItems.push(`${t.item} $${t.amount}`);
                } else {
                  transactionsToSave.push(transactionData);
                }
              }

              // Save non-duplicate transactions
              const savedDocs = await Promise.all(
                transactionsToSave.map(t => Transaction.create({ userId, ...t }))
              );

              // Build reply message
              let replyText = '';
              if (savedDocs.length > 0) {
                const summary = savedDocs.map(doc => 
                  `${doc.item} $${doc.amount} (${doc.category})`
                ).join('\n');
                replyText = `已為您記下：\n${summary}`;
              }

              if (duplicateItems.length > 0) {
                if (replyText) replyText += '\n\n';
                replyText += `⚠️ 以下項目在最近5分鐘內已記錄過，已自動跳過：\n${duplicateItems.join('\n')}`;
              }

              if (savedDocs.length === 0 && duplicateItems.length > 0) {
                // All transactions were duplicates
                replyText = `所有項目在最近5分鐘內都已記錄過，未重複記錄。\n\n重複項目：\n${duplicateItems.join('\n')}`;
              }

              if (replyText) {
                await client.replyMessage(replyToken, {
                  type: 'text',
                  text: replyText,
                });
              } else {
                await client.replyMessage(replyToken, { type: 'text', text: '抱歉，我不確定您想記什麼。' });
              }
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
              const chartUrl = await generatePieChartUrl(chartData, req.nextUrl.origin);
              
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

          case 'LIST_TRANSACTIONS':
            if (aiResult.query) {
              const transactions = await getTransactionList(userId, aiResult.query);
              if (transactions.length === 0) {
                await client.replyMessage(replyToken, { type: 'text', text: '該時段沒有任何交易紀錄。' });
              } else {
                const listText = transactions.map(t => {
                  const dateStr = new Date(t.date).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
                  return `${dateStr} ${t.item} $${t.amount} (${t.category})`;
                }).join('\n');
                await client.replyMessage(replyToken, { 
                  type: 'text', 
                  text: `📋 交易明細 (最近20筆):\n${listText}` 
                });
              }
            }
            break;

          case 'TOP_EXPENSE':
            if (aiResult.query) {
              const topStats = await getTopExpense(userId, aiResult.query);
              
              if (!topStats.topCategory && !topStats.topItem) {
                await client.replyMessage(replyToken, { type: 'text', text: '該時段沒有支出紀錄。' });
              } else {
                let reply = `🔥 消費之最 (${aiResult.query.startDate.split('T')[0]} ~ ${aiResult.query.endDate.split('T')[0]})\n\n`;
                
                if (topStats.topCategory) {
                  reply += `🏆 花費最多的種類: ${topStats.topCategory.category} (共 $${topStats.topCategory.total})\n`;
                }
                if (topStats.topItem) {
                  const dateStr = new Date(topStats.topItem.date).toLocaleDateString('zh-TW');
                  reply += `💸 最大筆單次支出: ${topStats.topItem.item} $${topStats.topItem.amount} (${dateStr})`;
                }
                
                await client.replyMessage(replyToken, { type: 'text', text: reply });
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

          case 'BULK_DELETE':
            if (aiResult.query) {
              const resultMsg = await bulkDeleteTransactions(userId, aiResult.query);
              await client.replyMessage(replyToken, { type: 'text', text: resultMsg });
            }
            break;

          case 'HELP':
            await client.replyMessage(replyToken, {
              type: 'text',
              text: `🤖 我是您的 AI 記帳助手，我可以幫您：

1. 📝 **記帳**
   - "午餐吃牛肉麵 150"
   - "昨天買飲料 50"
   - "發薪水 50000"
   - 📸 **傳送發票/收據照片，我也看得懂喔！**

2. 📊 **查詢統計**
   - "這個月花了多少？"
   - "上週飲食支出"
   - "今天總支出"

3. 🧾 **進階查詢**
   - "列出上週的所有支出" (查看明細)
   - "上個月花最多的是什麼？" (消費之最)

4. 🔧 **修改與刪除**
   - "刪除上一筆"
   - "Undo"
   - "刪除昨天所有交易" (批量刪除)

5. 🏷️ **查詢分類**
   - "有哪些分類？"

直接跟我聊天即可，我會自動理解您的意思！`,
            });
            break;

          case 'CATEGORY_LIST':
            await client.replyMessage(replyToken, {
              type: 'text',
              text: `📋 支援的自動分類項目：

1. 🍔 **Food** (餐飲)
2. 🚌 **Transport** (交通)
3. 🎬 **Entertainment** (娛樂)
4. 🛍️ **Shopping** (購物)
5. 🧾 **Bills** (帳單/繳費)
6. 💰 **Salary** (薪水/收入)
7. 📦 **Other** (其他)

💡 記帳時您不需手動指定，AI 會自動判斷！`,
            });
            break;

          case 'SMALL_TALK':
            if (aiResult.message) {
              await client.replyMessage(replyToken, {
                type: 'text',
                text: aiResult.message,
              });
            } else {
              await client.replyMessage(replyToken, {
                type: 'text',
                text: 'Hello! I am your AI accounting assistant.',
              });
            }
            break;

          case 'UNKNOWN':
          default:
            await client.replyMessage(replyToken, {
              type: 'text',
              text: '抱歉，我不確定您的意思。您可以試著問我：「你有哪些功能？」或直接說：「午餐100」。\n\n💡 您也可以直接傳送發票照片給我！',
            });
            break;
        }

      } catch (error) {
        console.error('Error processing event:', error);
        try {
          await client.replyMessage(replyToken, {
            type: 'text',
            text: '系統發生錯誤，請稍後再試。',
          });
        } catch (replyError) {
          console.error('Failed to send error reply:', replyError);
        }
      }
    }
  }));

  return NextResponse.json({ status: 'ok' });
}
