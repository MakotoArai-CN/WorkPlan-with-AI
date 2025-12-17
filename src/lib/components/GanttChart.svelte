<script>
    import { onMount, onDestroy } from 'svelte';
    import { Chart, registerables } from 'chart.js';
    import { taskStore } from '../stores/tasks.js';

    Chart.register(...registerables);

    let chartCanvas;
    let chartInstance;

    $: if (chartCanvas && $taskStore.tasks) {
        updateChart();
    }

    function updateChart() {
        const tasks = $taskStore.tasks
            .filter(t => t.status !== 'done')
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .slice(0, 15);

        if (tasks.length === 0) {
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
            return;
        }

        const labels = tasks.map(t => t.title.length > 15 ? t.title.substring(0, 15) + '...' : t.title);
        const startDates = tasks.map(t => new Date(t.date).getTime());
        const minDate = Math.min(...startDates);
        
        const data = tasks.map((t, index) => {
            const start = new Date(t.date);
            const end = t.deadline ? new Date(t.deadline) : new Date(start.getTime() + 86400000);
            const duration = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
            const offset = (start.getTime() - minDate) / 86400000;

            const colors = {
                normal: 'rgba(59, 130, 246, 0.8)',
                urgent: 'rgba(245, 158, 11, 0.8)',
                critical: 'rgba(239, 68, 68, 0.8)'
            };

            return {
                x: [offset, offset + duration],
                y: index,
                backgroundColor: colors[t.priority] || colors.normal
            };
        });

        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(chartCanvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: data.map(d => d.x),
                    backgroundColor: data.map(d => d.backgroundColor),
                    borderWidth: 0,
                    barThickness: 16,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: '任务甘特图',
                        font: { size: 14, weight: 'bold' }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const task = tasks[context.dataIndex];
                                const start = task.date.split('T')[0];
                                const end = task.deadline ? task.deadline.split('T')[0] : '无截止';
                                return `${start} → ${end}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'top',
                        title: {
                            display: true,
                            text: '天数'
                        },
                        ticks: {
                            stepSize: 1
                        }
                    },
                    y: {
                        ticks: {
                            autoSkip: false,
                            font: { size: 11 }
                        }
                    }
                }
            }
        });
    }

    onMount(() => {
        updateChart();
    });

    onDestroy(() => {
        if (chartInstance) {
            chartInstance.destroy();
        }
    });
</script>

<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6">
    <div class="h-[300px] md:h-[400px]">
        {#if $taskStore.tasks.filter(t => t.status !== 'done').length === 0}
            <div class="flex items-center justify-center h-full text-slate-400">
                <div class="text-center">
                    <i class="ph ph-chart-bar text-4xl mb-2"></i>
                    <p class="text-sm">暂无进行中的任务</p>
                </div>
            </div>
        {:else}
            <canvas bind:this={chartCanvas}></canvas>
        {/if}
    </div>
</div>