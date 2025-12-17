<script>
    import { onMount, onDestroy } from 'svelte';
    import { Chart, registerables } from 'chart.js';
    
    Chart.register(...registerables);
    
    export let tasks = [];
    export let type = 'pie';
    
    let chartCanvas;
    let chartInstance;
    
    $: if (chartCanvas && tasks) {
        updateChart();
    }
    
    function getStatusData() {
        const done = tasks.filter(t => t.status === 'done').length;
        const doing = tasks.filter(t => t.status === 'doing').length;
        const todo = tasks.filter(t => t.status === 'todo').length;
        return {
            labels: ['已完成', '进行中', '未开始'],
            data: [done, doing, todo],
            colors: ['#22c55e', '#3b82f6', '#94a3b8']
        };
    }
    
    function getPriorityData() {
        const critical = tasks.filter(t => t.priority === 'critical').length;
        const urgent = tasks.filter(t => t.priority === 'urgent').length;
        const normal = tasks.filter(t => t.priority === 'normal').length;
        return {
            labels: ['特急', '紧急', '普通'],
            data: [critical, urgent, normal],
            colors: ['#ef4444', '#f59e0b', '#3b82f6']
        };
    }
    
    function getWeeklyData() {
        const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        const completed = new Array(7).fill(0);
        const created = new Array(7).fill(0);
        
        tasks.forEach(t => {
            const date = new Date(t.date);
            const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
            created[dayIndex]++;
            if (t.status === 'done') {
                completed[dayIndex]++;
            }
        });
        
        return { days, completed, created };
    }
    
    function updateChart() {
        if (chartInstance) {
            chartInstance.destroy();
        }
        
        if (!chartCanvas || tasks.length === 0) return;
        
        const ctx = chartCanvas.getContext('2d');
        
        if (type === 'pie') {
            const statusData = getStatusData();
            chartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: statusData.labels,
                    datasets: [{
                        data: statusData.data,
                        backgroundColor: statusData.colors,
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                usePointStyle: true
                            }
                        },
                        title: {
                            display: true,
                            text: '任务状态分布',
                            font: { size: 14, weight: 'bold' }
                        }
                    }
                }
            });
        } else if (type === 'doughnut') {
            const priorityData = getPriorityData();
            chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: priorityData.labels,
                    datasets: [{
                        data: priorityData.data,
                        backgroundColor: priorityData.colors,
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                usePointStyle: true
                            }
                        },
                        title: {
                            display: true,
                            text: '优先级分布',
                            font: { size: 14, weight: 'bold' }
                        }
                    }
                }
            });
        } else if (type === 'bar') {
            const weeklyData = getWeeklyData();
            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: weeklyData.days,
                    datasets: [
                        {
                            label: '创建任务',
                            data: weeklyData.created,
                            backgroundColor: '#3b82f6',
                            borderRadius: 4
                        },
                        {
                            label: '完成任务',
                            data: weeklyData.completed,
                            backgroundColor: '#22c55e',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        title: {
                            display: true,
                            text: '本周任务统计',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            }
                        }
                    }
                }
            });
        } else if (type === 'line') {
            const weeklyData = getWeeklyData();
            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: weeklyData.days,
                    datasets: [
                        {
                            label: '创建趋势',
                            data: weeklyData.created,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: '完成趋势',
                            data: weeklyData.completed,
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(34, 197, 94, 0.1)',
                            fill: true,
                            tension: 0.4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        title: {
                            display: true,
                            text: '任务趋势',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            }
                        }
                    }
                }
            });
        } else if (type === 'radar') {
            const statusData = getStatusData();
            const priorityData = getPriorityData();
            chartInstance = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: ['已完成', '进行中', '未开始', '特急', '紧急', '普通'],
                    datasets: [{
                        label: '任务分布',
                        data: [...statusData.data, ...priorityData.data],
                        backgroundColor: 'rgba(99, 102, 241, 0.2)',
                        borderColor: '#6366f1',
                        pointBackgroundColor: '#6366f1',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#6366f1'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: '任务雷达图',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    scales: {
                        r: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            }
                        }
                    }
                }
            });
        } else if (type === 'polarArea') {
            const statusData = getStatusData();
            chartInstance = new Chart(ctx, {
                type: 'polarArea',
                data: {
                    labels: statusData.labels,
                    datasets: [{
                        data: statusData.data,
                        backgroundColor: [
                            'rgba(34, 197, 94, 0.7)',
                            'rgba(59, 130, 246, 0.7)',
                            'rgba(148, 163, 184, 0.7)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        title: {
                            display: true,
                            text: '极坐标图',
                            font: { size: 14, weight: 'bold' }
                        }
                    }
                }
            });
        }
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

<div class="w-full h-full min-h-[200px]">
    <canvas bind:this={chartCanvas}></canvas>
</div>