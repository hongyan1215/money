interface ChartData {
  labels: string[];
  data: number[];
}

export async function generatePieChartUrl(chartData: ChartData): Promise<string> {
  if (chartData.data.length === 0) return '';

  const chartConfig = {
    type: 'pie',
    data: {
      labels: chartData.labels,
      datasets: [{
        data: chartData.data,
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF'
        ]
      }]
    },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            font: { size: 10 }
          }
        },
        datalabels: {
          display: true,
          color: '#fff',
          formatter: (value: any) => {
            return value > 0 ? value : '';
          }
        }
      }
    }
  };

  try {
    const response = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chart: chartConfig,
        width: 500,
        height: 300,
        backgroundColor: 'transparent',
      }),
    });

    if (!response.ok) {
      console.error('QuickChart API Error:', await response.text());
      return '';
    }

    const result = await response.json();
    return result.url; // Returns a short URL
  } catch (error) {
    console.error('Failed to generate chart URL:', error);
    return '';
  }
}

