import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@line/bot-sdk';
import dbConnect from '@/lib/db';
import Transaction from '@/models/Transaction';
import { getTransactionStats } from '@/lib/stats';
import { generatePieChartUrl } from '@/lib/chart';

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const channelSecret = process.env.LINE_CHANNEL_SECRET!;

const client = new Client({
  channelAccessToken,
  channelSecret,
});

export async function GET(req: NextRequest) {
  // Security check: Verify that the request is authorized
  // For Vercel Cron, we can check for a specific header usually, or just rely on header validation provided by Vercel
  // CRON_SECRET is a common way to secure cron endpoints
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    await dbConnect();

    // 1. Find all distinct users who have transactions
    // In a production app, you'd have a User model. Here we infer from Transactions.
    const distinctUsers = await Transaction.distinct('userId');

    // 2. Calculate date range for "Last Week"
    // "Last Week" usually means Monday to Sunday of the previous week
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
    // Assuming this runs on Monday morning.
    // Last Monday = Today - 7 days
    // Last Sunday = Today - 1 day
    
    // However, to be safe regardless of when it runs, let's calculate "Previous ISO Week"
    const lastWeekEnd = new Date(today);
    lastWeekEnd.setDate(today.getDate() - dayOfWeek); // Go back to last Sunday
    lastWeekEnd.setHours(23, 59, 59, 999);

    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekEnd.getDate() - 6); // Go back 6 more days to Monday
    lastWeekStart.setHours(0, 0, 0, 0);

    const queryData = {
      startDate: lastWeekStart.toISOString(),
      endDate: lastWeekEnd.toISOString(),
      periodType: 'weekly' as const,
    };

    // 3. Generate and Send Report for each user
    const results = await Promise.all(distinctUsers.map(async (userId) => {
      const stats = await getTransactionStats(userId, queryData);
      
      if (stats.transactionCount === 0) return { userId, status: 'skipped' };

      const chartData = {
        labels: stats.breakdown.map(b => b._id),
        data: stats.breakdown.map(b => b.total)
      };
      const chartUrl = generatePieChartUrl(chartData);
      
      const replyText = `📅 上週消費週報\n(${lastWeekStart.toLocaleDateString('zh-TW')} ~ ${lastWeekEnd.toLocaleDateString('zh-TW')})\n\n` +
        `💰 總支出: $${stats.totalExpense}\n` +
        `💵 總收入: $${stats.totalIncome}\n` +
        `📝 交易筆數: ${stats.transactionCount}\n\n` +
        `🔥 前三大花費:\n` +
        stats.breakdown.slice(0, 3).map(b => `- ${b._id}: $${b.total}`).join('\n');

      try {
        if (chartUrl) {
          await client.pushMessage(userId, [
            { type: 'text', text: replyText },
            { 
              type: 'image', 
              originalContentUrl: chartUrl, 
              previewImageUrl: chartUrl 
            }
          ]);
        } else {
          await client.pushMessage(userId, { type: 'text', text: replyText });
        }
        return { userId, status: 'sent' };
      } catch (e) {
        console.error(`Failed to send report to ${userId}`, e);
        return { userId, status: 'failed' };
      }
    }));

    return NextResponse.json({ 
      message: 'Weekly reports processed', 
      results 
    });

  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

