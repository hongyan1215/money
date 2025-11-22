import mongoose from 'mongoose';
import Transaction from '@/models/Transaction';
import { ModificationData, QueryData } from '@/lib/ai';

// --- Types ---

export interface TransactionData {
  item: string;
  amount: number;
  category: string;
  type: string;
  date: Date | string;
}

export interface CreateResult {
  saved: any[];
  duplicates: string[];
}

export interface StatsResult {
  totalExpense: number;
  totalIncome: number;
  breakdown: { _id: string; total: number }[];
  transactionCount: number;
}

export interface TransactionDetail {
  item: string;
  amount: number;
  category: string;
  date: Date;
  type: 'expense' | 'income';
}

export interface TopExpenseResult {
  topCategory: { category: string; total: number } | null;
  topItem: { item: string; amount: number; date: Date } | null;
}

// --- Core Operations ---

/**
 * Create multiple transactions with validation, date parsing, and duplicate checking.
 */
export async function createTransactions(
  userId: string,
  transactions: TransactionData[]
): Promise<CreateResult> {
  const savedDocs = [];
  const duplicateItems = [];

  // Validation Filter
  const validTransactions = transactions.filter(t => t.item && t.amount && t.category && t.type);

  for (const t of validTransactions) {
    // Robust Date Parsing
    let dateObj = new Date(t.date);
    if (isNaN(dateObj.getTime())) {
      console.warn(`Invalid date received: ${t.date}, fallback to NOW.`);
      dateObj = new Date();
    }

    // Prepare data object
    const txData = {
      userId,
      item: t.item,
      amount: t.amount,
      category: t.category,
      type: t.type,
      date: dateObj
    };

    // Duplicate Check (5-minute window)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const duplicate = await Transaction.findOne({
      userId,
      item: txData.item,
      amount: txData.amount,
      category: txData.category,
      type: txData.type,
      date: { $gte: fiveMinutesAgo, $lte: new Date() }
    });

    if (duplicate) {
      duplicateItems.push(`${txData.item} $${txData.amount}`);
    } else {
      const doc = await Transaction.create(txData);
      savedDocs.push(doc);
    }
  }

  return { saved: savedDocs, duplicates: duplicateItems };
}

/**
 * Get spending statistics for a given period.
 */
export async function getTransactionStats(
  userId: string,
  query: QueryData
): Promise<StatsResult> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const matchStage: any = {
    userId,
    date: { $gte: start, $lte: end },
  };

  if (query.category) {
    matchStage.category = query.category;
  }

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

  const breakdown = await Transaction.aggregate([
    { 
      $match: { 
        ...matchStage, 
        type: 'expense' 
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

/**
 * Get a detailed list of transactions.
 */
export async function getTransactionList(
  userId: string,
  query: QueryData
): Promise<TransactionDetail[]> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const filter: any = {
    userId,
    date: { $gte: start, $lte: end },
  };

  if (query.category) {
    filter.category = query.category;
  }

  const transactions = await Transaction.find(filter)
    .sort({ date: -1 })
    .limit(20);

  return transactions.map(t => ({
    item: t.item,
    amount: t.amount,
    category: t.category,
    date: t.date,
    type: t.type as 'expense' | 'income'
  }));
}

/**
 * Get the top expense category and single item.
 */
export async function getTopExpense(
  userId: string,
  query: QueryData
): Promise<TopExpenseResult> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const matchStage = {
    userId,
    type: 'expense',
    date: { $gte: start, $lte: end },
  };

  // Top Category
  const categoryStats = await Transaction.aggregate([
    { $match: matchStage },
    { $group: { _id: '$category', total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
    { $limit: 1 }
  ]);

  // Top Single Item
  const itemStats = await Transaction.find(matchStage)
    .sort({ amount: -1 })
    .limit(1);

  return {
    topCategory: categoryStats.length > 0 ? { category: categoryStats[0]._id, total: categoryStats[0].total } : null,
    topItem: itemStats.length > 0 ? { item: itemStats[0].item, amount: itemStats[0].amount, date: itemStats[0].date } : null
  };
}

/**
 * Modify or delete a specific transaction.
 */
export async function modifyTransaction(
  userId: string,
  mod: ModificationData
): Promise<string> {
  const limit = (mod.indexOffset || 0) + 1;
  const transactions = await Transaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit);

  if (transactions.length === 0 || transactions.length < limit) {
    return '找不到可操作的交易紀錄。';
  }

  const targetTx = transactions[limit - 1];

  if (mod.action === 'DELETE') {
    await Transaction.findByIdAndDelete(targetTx._id);
    return `已刪除：${targetTx.item} $${targetTx.amount}`;
  } else if (mod.action === 'UPDATE') {
    if (mod.newAmount) targetTx.amount = mod.newAmount;
    if (mod.newItem) targetTx.item = mod.newItem;
    if (mod.newCategory) targetTx.category = mod.newCategory;
    
    await targetTx.save();
    return `已更新為：${targetTx.item} $${targetTx.amount} (${targetTx.category})`;
  }

  return '未知的操作指令。';
}

/**
 * Delete multiple transactions in a date range.
 */
export async function bulkDeleteTransactions(
  userId: string,
  query: QueryData
): Promise<string> {
  const start = new Date(query.startDate);
  const end = new Date(query.endDate);

  const filter: any = {
    userId,
    date: { $gte: start, $lte: end },
  };

  if (!query.startDate || !query.endDate) {
    return '批量刪除需要明確的日期範圍。';
  }

  const result = await Transaction.deleteMany(filter);

  if (result.deletedCount === 0) {
    return '該時段沒有可刪除的交易紀錄。';
  }

  return `已刪除 ${result.deletedCount} 筆交易紀錄 (${query.startDate.split('T')[0]} ~ ${query.endDate.split('T')[0]})。`;
}

