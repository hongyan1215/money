'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title
);

interface Transaction {
  _id: string;
  date: string;
  item: string;
  amount: number;
  category: string;
  type: 'expense' | 'income';
}

interface Stats {
  totalExpense: number;
  totalIncome: number;
  categoryBreakdown: { _id: string; total: number }[];
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Transaction>>({});

  // Initialize date range to current month
  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // Format YYYY-MM-DD for input type="date"
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, []);

  const fetchData = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      // Fetch Transactions
      const resTrans = await fetch(
        `/api/transactions?startDate=${startDate}&endDate=${endDate}&limit=100`
      );
      const dataTrans = await resTrans.json();
      setTransactions(dataTrans.data || []);

      // Fetch Stats
      const resStats = await fetch(
        `/api/stats?startDate=${startDate}&endDate=${endDate}`
      );
      const dataStats = await resStats.json();
      setStats(dataStats);
    } catch (error) {
      console.error('Failed to fetch data', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this transaction?')) return;
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData(); // Refresh
      } else {
        alert('Failed to delete');
      }
    } catch (error) {
      console.error(error);
      alert('Error deleting');
    }
  }, []);

  const handleEditClick = useCallback((t: Transaction) => {
    setEditingId(t._id);
    setEditForm({ ...t, date: t.date.split('T')[0] });
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!editingId) return;
    try {
      const res = await fetch(`/api/transactions/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingId(null);
        fetchData();
      } else {
        alert('Failed to update');
      }
    } catch (error) {
      console.error(error);
      alert('Error updating');
    }
  }, [editingId, editForm]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditForm({});
  }, []);

  // Memoized Chart Data to prevent unnecessary re-renders
  const chartData = useMemo(() => ({
    labels: stats?.categoryBreakdown.map((c) => c._id) || [],
    datasets: [
      {
        data: stats?.categoryBreakdown.map((c) => c.total) || [],
        backgroundColor: [
          '#FF6384',
          '#36A2EB',
          '#FFCE56',
          '#4BC0C0',
          '#9966FF',
          '#FF9F40',
          '#C9CBCF',
        ],
        borderWidth: 1,
      },
    ],
  }), [stats?.categoryBreakdown]);

  // Memoized net balance calculation
  const netBalance = useMemo(() => {
    return (stats?.totalIncome || 0) - (stats?.totalExpense || 0);
  }, [stats?.totalIncome, stats?.totalExpense]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <h1 className="text-3xl font-bold text-gray-800">記帳助手 Dashboard</h1>
          <div className="flex gap-2 items-center bg-white p-2 rounded shadow">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border rounded px-2 py-1"
            />
            <span>to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
            <h3 className="text-gray-500 text-sm uppercase">Total Expense</h3>
            <p className="text-2xl font-bold text-red-600">
              ${stats?.totalExpense?.toLocaleString() || 0}
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
            <h3 className="text-gray-500 text-sm uppercase">Total Income</h3>
            <p className="text-2xl font-bold text-green-600">
              ${stats?.totalIncome?.toLocaleString() || 0}
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
            <h3 className="text-gray-500 text-sm uppercase">Net Balance</h3>
            <p className={`text-2xl font-bold ${netBalance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
              ${netBalance.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Chart Section */}
          <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Expenses by Category</h2>
            <div className="relative h-64">
              {stats && stats.totalExpense > 0 ? (
                <Doughnut data={chartData} options={{ maintainAspectRatio: false }} />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  No expense data
                </div>
              )}
            </div>
          </div>

          {/* Transactions Table Section */}
          <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow overflow-hidden">
            <h2 className="text-xl font-semibold mb-4">Recent Transactions</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b text-gray-600 text-sm uppercase bg-gray-50">
                    <th className="p-3">Date</th>
                    <th className="p-3">Item</th>
                    <th className="p-3">Category</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center">Loading...</td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-gray-500">No transactions found</td>
                    </tr>
                  ) : (
                    transactions.map((t) => (
                      <tr key={t._id} className="border-b hover:bg-gray-50">
                        {editingId === t._id ? (
                          <>
                            <td className="p-3">
                              <input
                                type="date"
                                value={editForm.date || ''}
                                onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                                className="border rounded p-1 w-full"
                              />
                            </td>
                            <td className="p-3">
                              <input
                                type="text"
                                value={editForm.item || ''}
                                onChange={(e) => setEditForm({...editForm, item: e.target.value})}
                                className="border rounded p-1 w-full"
                              />
                            </td>
                            <td className="p-3">
                              <select
                                value={editForm.category || ''}
                                onChange={(e) => setEditForm({...editForm, category: e.target.value})}
                                className="border rounded p-1 w-full"
                              >
                                <option value="Food">Food</option>
                                <option value="Transport">Transport</option>
                                <option value="Entertainment">Entertainment</option>
                                <option value="Shopping">Shopping</option>
                                <option value="Bills">Bills</option>
                                <option value="Other">Other</option>
                              </select>
                            </td>
                            <td className="p-3 text-right">
                              <input
                                type="number"
                                value={editForm.amount || 0}
                                onChange={(e) => setEditForm({...editForm, amount: Number(e.target.value)})}
                                className="border rounded p-1 w-24 text-right"
                              />
                            </td>
                            <td className="p-3 text-center flex gap-2 justify-center">
                              <button onClick={handleUpdate} className="text-green-600 hover:text-green-800 font-bold">Save</button>
                              <button onClick={handleCancelEdit} className="text-gray-500 hover:text-gray-700">Cancel</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="p-3 text-gray-600">{new Date(t.date).toLocaleDateString()}</td>
                            <td className="p-3 font-medium">{t.item}</td>
                            <td className="p-3">
                              <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 border">
                                {t.category}
                              </span>
                            </td>
                            <td className={`p-3 text-right font-bold ${t.type === 'income' ? 'text-green-600' : 'text-gray-800'}`}>
                              {t.type === 'income' ? '+' : '-'}${t.amount.toLocaleString()}
                            </td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => handleEditClick(t)}
                                className="text-blue-500 hover:text-blue-700 mr-3"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(t._id)}
                                className="text-red-500 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

