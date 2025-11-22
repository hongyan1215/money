import mongoose from 'mongoose';
import Transaction from '@/models/Transaction';
import { QueryData } from '@/lib/ai';

export interface StatsResult {
  totalExpense: number;
  totalIncome: number;
  breakdown: { _id: string; total: number }[];
  transactionCount: number;
}

export async function getTransactionStats(
  userId: string,
  query: QueryData
): Promise<StatsResult> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  // Base Match Query
  const matchStage: any = {
    userId,
    date: { $gte: start, $lte: end },
  };

  if (query.category) {
    matchStage.category = query.category;
  }

  // Aggregation for Total Expense/Income
  const totals = await Transaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  let totalExpense = 0;
  let totalIncome = 0;
  let transactionCount = 0;

  totals.forEach((t) => {
    if (t._id === 'expense') totalExpense = t.total;
    if (t._id === 'income') totalIncome = t.total;
    transactionCount += t.count;
  });

  // Aggregation for Category Breakdown (only for expenses usually)
  const breakdown = await Transaction.aggregate([
    { 
      $match: { 
        ...matchStage, 
        type: 'expense' // Usually we care about expense breakdown
      } 
    },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
      },
    },
    { $sort: { total: -1 } },
  ]);

  return {
    totalExpense,
    totalIncome,
    breakdown,
    transactionCount,
  };
}

