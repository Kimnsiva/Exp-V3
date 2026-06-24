// app.js - KimCash Personal Finance Tracker

// ==================== STATE MANAGEMENT ====================
let state = {
    selectedMonth: "", // YYYY-MM
    baseSalary: 0,
    incomes: [],       // { id, title, amount, type: 'one-time'|'recurring', date }
    expenses: [],      // { id, title, amount, type: 'one-time'|'recurring', category, date }
    installments: [],  // { id, title, totalAmount, monthlyAmount, totalMonths, startMonth, category }
    dcaList: [],       // { id, title, amount, type: 'one-time'|'recurring', category, date }
    welfareSettings: {
        pvdType: "percent", // percent | fixed
        pvdValue: 3,
        ssoType: "auto",    // auto | fixed
        ssoValue: 750
    },
    carryOverEnabled: true
};

// ==================== FIREBASE CONFIGURATION ====================
const firebaseConfig = {
    apiKey: "AIzaSyDstD06DHxVK3JS0dTlz3qxVDgQfjFhaeI",
    authDomain: "kimcash-km.firebaseapp.com",
    projectId: "kimcash-km",
    storageBucket: "kimcash-km.firebasestorage.app",
    messagingSenderId: "405838515046",
    appId: "1:405838515046:web:227f6eddecf78d5236d6a7"
};

const isFirebaseConfigured = Object.keys(firebaseConfig).length > 0;
let db = null;
let auth = null;

if (isFirebaseConfigured) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();

    auth.onAuthStateChanged((user) => {
        const overlay = document.getElementById("auth-overlay");
        const logoutBtn = document.getElementById("menu-logout");
        if (user) {
            if (overlay) overlay.style.display = "none";
            if (logoutBtn) logoutBtn.style.display = "flex";

            db.collection("users").doc(user.uid).get().then(doc => {
                if (doc.exists) {
                    state = { ...state, ...doc.data() };
                    localStorage.setItem("kimcash_state", JSON.stringify(state));
                    updateAppView();
                }
            }).catch(err => console.error("Error loading from Firebase:", err));

            db.collection("users").doc(user.uid).onSnapshot(doc => {
                if (doc.exists) {
                    state = { ...state, ...doc.data() };
                    localStorage.setItem("kimcash_state", JSON.stringify(state));
                    updateAppView();
                }
            });
        } else {
            if (overlay) overlay.style.display = "flex";
            if (logoutBtn) logoutBtn.style.display = "none";
        }
    });
}

// Colors for categories
const categoryStyles = {
    food: { label: "Food & Beverage", color: "#e11d48" },
    housing: { label: "Housing & Utilities", color: "#d97706" },
    travel: { label: "Transportation & Gas", color: "#0891b2" },
    personal: { label: "Personal & Shopping", color: "#2563eb" },
    health: { label: "Health & Medical", color: "#65a30d" },
    entertainment: { label: "Entertainment & Travel", color: "#c026d3" },
    education: { label: "Education & Upskill", color: "#ea580c" },
    family: { label: "Family & Care", color: "#7c3aed" },
    other: { label: "Others", color: "#64748b" },
    installments: { label: "Installments", color: "#0284c7" }
};

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", () => {
    initDefaultState();
    loadStateFromLocalStorage();
    setupEventListeners();
    switchView("dashboard");
    updateAppView();
});

function initDefaultState() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    state.selectedMonth = `${year}-${month}`;
}

// ==================== STORAGE OPERATIONS ====================
function saveStateToLocalStorage() {
    localStorage.setItem("kimcash_state", JSON.stringify(state));

    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).set(state)
            .catch(err => console.error("Error saving to Firebase:", err));
    }
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem("kimcash_state");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state = { ...state, ...parsed };
        } catch (e) {
            console.error("Error parsing saved state:", e);
            showToast("Failed to load saved data", "error");
        }
    }
}

// ==================== FINANCIAL CALCULATION ENGINE ====================
function getMonthDiff(startMonthStr, targetMonthStr) {
    const [startY, startM] = startMonthStr.split("-").map(Number);
    const [targetY, targetM] = targetMonthStr.split("-").map(Number);
    return (targetY - startY) * 12 + (targetM - startM);
}

function calculateTimeline() {
    const monthsSet = new Set([state.selectedMonth]);

    state.incomes.forEach(item => { if (item.date && item.type === "one-time") monthsSet.add(item.date.slice(0, 7)); });
    state.expenses.forEach(item => { if (item.date && item.type === "one-time") monthsSet.add(item.date.slice(0, 7)); });
    state.dcaList.forEach(item => { if (item.date && item.type === "one-time") monthsSet.add(item.date.slice(0, 7)); });
    state.installments.forEach(item => {
        monthsSet.add(item.startMonth);
        const [startY, startM] = item.startMonth.split("-").map(Number);
        for (let i = 0; i < item.totalMonths; i++) {
            const m = startM + i;
            const yOffset = Math.floor((m - 1) / 12);
            const actualM = String(((m - 1) % 12) + 1).padStart(2, '0');
            const actualY = startY + yOffset;
            monthsSet.add(`${actualY}-${actualM}`);
        }
    });

    const uniqueMonths = Array.from(monthsSet).sort();
    const earliestMonth = uniqueMonths[0];
    const targetMonth = state.selectedMonth;

    const contiguousTimeline = [];
    let current = earliestMonth;

    while (current <= targetMonth) {
        contiguousTimeline.push(current);
        const [y, m] = current.split("-").map(Number);
        const nextM = m + 1;
        const actualNextY = y + Math.floor((nextM - 1) / 12);
        const actualNextM = String(((nextM - 1) % 12) + 1).padStart(2, '0');
        current = `${actualNextY}-${actualNextM}`;
    }

    const timelineResults = {};
    let carryOverBalance = 0;

    contiguousTimeline.forEach(month => {
        let grossIncome = Number(state.baseSalary || 0);
        let recurringIncome = Number(state.baseSalary || 0);
        let oneTimeIncome = 0;

        state.incomes.forEach(inc => {
            const amt = Number(inc.amount);
            if (inc.type === "recurring") {
                grossIncome += amt;
                recurringIncome += amt;
            } else if (inc.type === "one-time" && inc.date.slice(0, 7) === month) {
                grossIncome += amt;
                oneTimeIncome += amt;
            }
        });

        let pvdAmount = 0;
        let ssoAmount = 0;

        if (state.baseSalary > 0) {
            const w = state.welfareSettings;
            if (w.pvdType === "percent") {
                pvdAmount = state.baseSalary * (Number(w.pvdValue) / 100);
            } else {
                pvdAmount = Number(w.pvdValue);
            }

            if (w.ssoType === "auto") {
                ssoAmount = Math.min(state.baseSalary * 0.05, 750);
            } else {
                ssoAmount = Number(w.ssoValue);
            }
        }

        let totalDca = 0;
        const activeDcaList = [];
        state.dcaList.forEach(dca => {
            const amt = Number(dca.amount);
            if (dca.type === "recurring") {
                totalDca += amt;
                activeDcaList.push({ ...dca, computedAmount: amt });
            } else if (dca.type === "one-time" && dca.date.slice(0, 7) === month) {
                totalDca += amt;
                activeDcaList.push({ ...dca, computedAmount: amt });
            }
        });

        const totalDeductions = pvdAmount + ssoAmount + totalDca;
        const disposableIncome = grossIncome - totalDeductions;

        let generalExpenses = 0;
        let recurringExpense = 0;
        let oneTimeExpense = 0;
        const activeExpensesList = [];

        state.expenses.forEach(exp => {
            const amt = Number(exp.amount);
            if (exp.type === "recurring") {
                generalExpenses += amt;
                recurringExpense += amt;
                activeExpensesList.push({ ...exp, computedAmount: amt });
            } else if (exp.type === "one-time" && exp.date.slice(0, 7) === month) {
                generalExpenses += amt;
                oneTimeExpense += amt;
                activeExpensesList.push({ ...exp, computedAmount: amt });
            }
        });

        let installmentExpenses = 0;
        const activeInstallmentsList = [];

        state.installments.forEach(inst => {
            const diff = getMonthDiff(inst.startMonth, month);
            if (diff >= 0 && diff < inst.totalMonths) {
                const amt = Number(inst.monthlyAmount);
                installmentExpenses += amt;
                activeInstallmentsList.push({
                    ...inst,
                    currentInstallmentIndex: diff + 1,
                    computedAmount: amt
                });
            }
        });

        const totalExpenses = generalExpenses + installmentExpenses;
        const inputCarry = state.carryOverEnabled ? carryOverBalance : 0;
        const netBalance = (disposableIncome + inputCarry) - totalExpenses;

        timelineResults[month] = {
            month,
            carryOver: inputCarry,
            grossIncome,
            recurringIncome,
            oneTimeIncome,
            pvd: pvdAmount,
            sso: ssoAmount,
            totalDca,
            activeDcaList,
            totalDeductions,
            disposableIncome,
            generalExpenses,
            installmentExpenses,
            totalExpenses,
            activeExpensesList,
            activeInstallmentsList,
            netBalance
        };

        carryOverBalance = netBalance;
    });

    return timelineResults;
}

// ==================== RENDERING & UI UPDATING ====================
function updateAppView() {
    const results = calculateTimeline();
    const currentData = results[state.selectedMonth] || {
        month: state.selectedMonth,
        carryOver: 0, grossIncome: 0, recurringIncome: 0, oneTimeIncome: 0,
        pvd: 0, sso: 0, totalDca: 0, activeDcaList: [],
        totalDeductions: 0, disposableIncome: 0, generalExpenses: 0,
        installmentExpenses: 0, totalExpenses: 0, activeExpensesList: [],
        activeInstallmentsList: [], netBalance: 0
    };

    updateMonthHeader();
    renderSummaryCards(currentData);
    renderDashboardDetails(currentData);
    renderIncomeView(currentData);
    renderDeductionsView(currentData);
    renderExpensesView(currentData);
    renderInstallmentsView(currentData);
    renderSettingsView();
}

function updateMonthHeader() {
    const [year, month] = state.selectedMonth.split("-").map(Number);
    document.getElementById("selected-month-year").textContent = `${MONTHS[month - 1]} ${year}`;
}

function renderSummaryCards(data) {
    // Carry-over
    const carryValEl = document.getElementById("card-carry-value");
    const carryStatEl = document.getElementById("card-carry-status");
    carryValEl.textContent = formatCurrency(data.carryOver);
    if (data.carryOver > 0) {
        carryValEl.className = "card-value text-income";
        carryStatEl.textContent = "Surplus carried forward";
    } else if (data.carryOver < 0) {
        carryValEl.className = "card-value text-danger";
        carryStatEl.textContent = "Deficit carried forward";
    } else {
        carryValEl.className = "card-value";
        carryStatEl.textContent = "No carry-over balance";
    }

    // Gross Income
    document.getElementById("card-income-value").textContent = formatCurrency(data.grossIncome);
    document.getElementById("card-income-recurring-ratio").textContent =
        `Recurring: ${formatCurrency(state.baseSalary)} | Other: ${formatCurrency(data.oneTimeIncome)}`;

    // Deductions
    document.getElementById("card-savings-value").textContent = formatCurrency(data.totalDeductions);
    document.getElementById("card-take-home-value").textContent = `After savings: ${formatCurrency(data.disposableIncome)}`;

    // Expenses
    document.getElementById("card-expense-value").textContent = formatCurrency(data.totalExpenses);
    document.getElementById("card-installment-ratio").textContent =
        `General: ${formatCurrency(data.generalExpenses)} | Installments: ${formatCurrency(data.installmentExpenses)}`;

    // Net Balance
    const netValEl = document.getElementById("card-net-value");
    const netCardEl = netValEl.closest(".card-net");
    netValEl.textContent = formatCurrency(data.netBalance);
    if (data.netBalance >= 0) {
        netCardEl.className = "card glass-card card-net net-positive";
        document.getElementById("card-net-status").textContent = "Carries over to next month";
    } else {
        netCardEl.className = "card glass-card card-net net-negative";
        document.getElementById("card-net-status").textContent = "Deficit carries to next month";
    }
}

function renderDashboardDetails(data) {
    // Savings Rate
    const savingsRate = data.grossIncome > 0 ? (data.totalDeductions / data.grossIncome) * 100 : 0;
    document.getElementById("metric-savings-rate-val").textContent = `${savingsRate.toFixed(1)}%`;
    document.getElementById("metric-savings-rate-bar").style.width = `${Math.min(savingsRate, 100)}%`;

    // Expense Ratio
    const expenseRatio = data.disposableIncome > 0 ? (data.totalExpenses / data.disposableIncome) * 100 : 0;
    document.getElementById("metric-expense-ratio-val").textContent = `${expenseRatio.toFixed(1)}%`;
    document.getElementById("metric-expense-ratio-bar").style.width = `${Math.min(expenseRatio, 100)}%`;

    const expenseRatioBar = document.getElementById("metric-expense-ratio-bar");
    if (expenseRatio > 90) {
        expenseRatioBar.style.background = "var(--color-expense)";
    } else if (expenseRatio > 70) {
        expenseRatioBar.style.background = "var(--color-warning)";
    } else {
        expenseRatioBar.style.background = "var(--color-expense)";
    }

    renderDonutChart(data);

    // Quick Lists
    const incList = document.getElementById("quick-income-list");
    incList.innerHTML = "";
    if (state.baseSalary > 0) {
        incList.appendChild(createQuickLi("Base Salary", "Recurring", state.baseSalary, "text-income"));
    }
    const currentMonthIncomes = state.incomes.filter(i => i.type === "recurring" || i.date.slice(0, 7) === state.selectedMonth);
    currentMonthIncomes.forEach(inc => {
        incList.appendChild(createQuickLi(inc.title, inc.type === "recurring" ? "Recurring" : "One-time", inc.amount, "text-income"));
    });
    if (incList.children.length === 0) {
        incList.innerHTML = `<li class="empty-item">No income data</li>`;
    }

    const savList = document.getElementById("quick-savings-list");
    savList.innerHTML = "";
    if (data.pvd > 0) {
        savList.appendChild(createQuickLi("Provident Fund (PVD)", "Welfare", data.pvd, "text-savings"));
    }
    if (data.sso > 0) {
        savList.appendChild(createQuickLi("Social Security (SSO)", "Welfare", data.sso, "text-savings"));
    }
    data.activeDcaList.forEach(dca => {
        savList.appendChild(createQuickLi(dca.title, `${categoryStyles[dca.category]?.label || 'Investment'} (DCA)`, dca.computedAmount, "text-savings"));
    });
    if (savList.children.length === 0) {
        savList.innerHTML = `<li class="empty-item">No savings deductions</li>`;
    }

    const expList = document.getElementById("quick-expense-list");
    expList.innerHTML = "";
    data.activeExpensesList.forEach(exp => {
        expList.appendChild(createQuickLi(exp.title, `${categoryStyles[exp.category]?.label || 'Others'}`, exp.computedAmount, "text-danger"));
    });
    data.activeInstallmentsList.forEach(inst => {
        expList.appendChild(createQuickLi(inst.title, `Installment ${inst.currentInstallmentIndex}/${inst.totalMonths}`, inst.computedAmount, "text-danger"));
    });
    if (expList.children.length === 0) {
        expList.innerHTML = `<li class="empty-item">No expense data</li>`;
    }
}

function createQuickLi(name, typeText, val, textClass) {
    const li = document.createElement("li");
    li.innerHTML = `
        <div>
            <span class="quick-item-name">${name}</span>
            <span class="quick-item-meta">${typeText}</span>
        </div>
        <span class="quick-item-val ${textClass}">฿${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    `;
    return li;
}

function renderDonutChart(data) {
    const segmentsContainer = document.getElementById("donut-segments");
    const legendContainer = document.getElementById("chart-legend-container");

    segmentsContainer.innerHTML = "";
    legendContainer.innerHTML = "";

    const catAmounts = {};
    let total = 0;

    data.activeExpensesList.forEach(exp => {
        const amt = Number(exp.computedAmount);
        catAmounts[exp.category] = (catAmounts[exp.category] || 0) + amt;
        total += amt;
    });

    if (data.installmentExpenses > 0) {
        catAmounts["installments"] = (catAmounts["installments"] || 0) + data.installmentExpenses;
        total += data.installmentExpenses;
    }

    document.getElementById("chart-center-expense").textContent = `฿${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

    if (total === 0) {
        segmentsContainer.innerHTML = `<circle cx="100" cy="100" r="70" class="chart-bg" />`;
        legendContainer.innerHTML = `<div class="no-data-msg">No expenses this month</div>`;
        return;
    }

    const items = Object.keys(catAmounts).map(catKey => {
        const amt = catAmounts[catKey];
        return {
            key: catKey,
            amount: amt,
            percentage: (amt / total) * 100,
            style: categoryStyles[catKey] || { label: "Others", color: "#94a3b8" }
        };
    }).sort((a, b) => b.amount - a.amount);

    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let accumulatedPercent = 0;

    items.forEach(item => {
        const dashArrayVal = (item.percentage / 100) * circumference;

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "100");
        circle.setAttribute("cy", "100");
        circle.setAttribute("r", radius);
        circle.setAttribute("class", "chart-segment");
        circle.setAttribute("stroke", item.style.color);
        circle.setAttribute("stroke-dasharray", `${dashArrayVal} ${circumference}`);
        circle.setAttribute("stroke-dashoffset", -((accumulatedPercent / 100) * circumference));
        segmentsContainer.appendChild(circle);

        accumulatedPercent += item.percentage;

        const legendDiv = document.createElement("div");
        legendDiv.className = "legend-item";
        legendDiv.innerHTML = `
            <div class="legend-left">
                <span class="legend-dot" style="background-color: ${item.style.color}"></span>
                <span class="legend-label">${item.style.label} <span class="legend-percent">${item.percentage.toFixed(1)}%</span></span>
            </div>
            <span class="legend-val">฿${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        `;
        legendContainer.appendChild(legendDiv);
    });
}

// ==================== VIEW 2: INCOMES ====================
function renderIncomeView(data) {
    document.getElementById("input-base-salary").value = state.baseSalary || "";

    const tbody = document.getElementById("income-table-body");
    tbody.innerHTML = "";

    if (state.baseSalary > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>Base Salary</strong></td>
            <td><span class="badge badge-recurring">Recurring</span></td>
            <td>—</td>
            <td class="text-right td-amount text-income">฿${state.baseSalary.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Edit above</span></td>
        `;
        tbody.appendChild(row);
    }

    const activeIncomes = state.incomes.filter(inc => {
        return inc.type === "recurring" || inc.date.slice(0, 7) === state.selectedMonth;
    });

    activeIncomes.forEach(inc => {
        const row = document.createElement("tr");
        const badgeClass = inc.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = inc.type === "recurring" ? "Recurring" : "One-time";

        row.innerHTML = `
            <td>${escapeHTML(inc.title)}</td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td>${inc.type === "one-time" ? formatDate(inc.date) : "—"}</td>
            <td class="text-right td-amount text-income">฿${Number(inc.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditIncome('${inc.id}')" title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteIncome('${inc.id}')" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center no-data">No additional income this month</td></tr>`;
    }
}

// ==================== VIEW 3: DEDUCTIONS & DCA ====================
function renderDeductionsView(data) {
    const w = state.welfareSettings;

    document.getElementById("pvd-type-percent").checked = w.pvdType === "percent";
    document.getElementById("pvd-type-fixed").checked = w.pvdType === "fixed";
    document.getElementById("pvd-percent-input").value = w.pvdValue && w.pvdType === "percent" ? w.pvdValue : 3;
    document.getElementById("pvd-fixed-input").value = w.pvdValue && w.pvdType === "fixed" ? w.pvdValue : 0;

    togglePvdInputGroup(w.pvdType);

    document.getElementById("sso-type-auto").checked = w.ssoType === "auto";
    document.getElementById("sso-type-fixed").checked = w.ssoType === "fixed";
    document.getElementById("sso-fixed-input").value = w.ssoValue;

    toggleSsoInputGroup(w.ssoType);

    const tbody = document.getElementById("dca-table-body");
    tbody.innerHTML = "";

    if (data.pvd > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>Provident Fund (PVD)</strong></td>
            <td><span class="badge badge-savings">Welfare</span></td>
            <td><span class="badge badge-recurring">Recurring</span></td>
            <td>—</td>
            <td class="text-right td-amount text-savings">฿${data.pvd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Edit above</span></td>
        `;
        tbody.appendChild(row);
    }

    if (data.sso > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>Social Security (SSO)</strong></td>
            <td><span class="badge badge-savings">Welfare</span></td>
            <td><span class="badge badge-recurring">Recurring</span></td>
            <td>—</td>
            <td class="text-right td-amount text-savings">฿${data.sso.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Edit above</span></td>
        `;
        tbody.appendChild(row);
    }

    data.activeDcaList.forEach(dca => {
        const row = document.createElement("tr");
        const badgeClass = dca.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = dca.type === "recurring" ? "Recurring" : "One-time";
        const assetLabel = categoryStyles[dca.category]?.label || "Investment";

        row.innerHTML = `
            <td>${escapeHTML(dca.title)}</td>
            <td><span class="badge badge-savings" style="background-color: rgba(139, 92, 246, 0.1)">${assetLabel}</span></td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td>${dca.type === "one-time" ? formatDate(dca.date) : "—"}</td>
            <td class="text-right td-amount text-savings">฿${Number(dca.computedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditDca('${dca.id}')" title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteDca('${dca.id}')" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center no-data">No savings or DCA this month</td></tr>`;
    }
}

// ==================== VIEW 4: GENERAL EXPENSES ====================
function renderExpensesView(data) {
    const tbody = document.getElementById("expense-table-body");
    tbody.innerHTML = "";

    data.activeInstallmentsList.forEach(inst => {
        const row = document.createElement("tr");
        const assetLabel = categoryStyles[inst.category]?.label || "Others";
        row.innerHTML = `
            <td><strong>[Installment] ${escapeHTML(inst.title)}</strong></td>
            <td><span class="badge badge-recurring">Installment ${inst.currentInstallmentIndex}/${inst.totalMonths}</span></td>
            <td><span class="badge badge-credit">${assetLabel}</span></td>
            <td>—</td>
            <td class="text-right td-amount text-danger">฿${Number(inst.computedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Manage in Installments</span></td>
        `;
        tbody.appendChild(row);
    });

    data.activeExpensesList.forEach(exp => {
        const row = document.createElement("tr");
        const badgeClass = exp.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = exp.type === "recurring" ? "Recurring" : "One-time";
        const catLabel = categoryStyles[exp.category]?.label || "Others";

        row.innerHTML = `
            <td>${escapeHTML(exp.title)}</td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td><span class="badge badge-expense">${catLabel}</span></td>
            <td>${exp.type === "one-time" ? formatDate(exp.date) : "—"}</td>
            <td class="text-right td-amount text-danger">฿${Number(exp.computedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditExpense('${exp.id}')" title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteExpense('${exp.id}')" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center no-data">No expenses this month</td></tr>`;
    }
}

// ==================== VIEW 5: INSTALLMENTS ====================
function renderInstallmentsView(data) {
    const tbody = document.getElementById("installment-table-body");
    tbody.innerHTML = "";

    state.installments.forEach(inst => {
        const row = document.createElement("tr");
        const diff = getMonthDiff(inst.startMonth, state.selectedMonth);
        let statusBadge = "";

        if (diff < 0) {
            statusBadge = `<span class="badge" style="background-color: rgba(234, 179, 8, 0.08); color: var(--color-warning);">Not started (${formatMonthYear(inst.startMonth)})</span>`;
        } else if (diff >= inst.totalMonths) {
            statusBadge = `<span class="badge" style="background-color: rgba(5, 150, 105, 0.08); color: var(--color-income);">Fully paid</span>`;
        } else {
            statusBadge = `<span class="badge badge-credit">Paying ${diff + 1}/${inst.totalMonths}</span>`;
        }

        const catLabel = categoryStyles[inst.category]?.label || "Others";

        row.innerHTML = `
            <td>
                <strong>${escapeHTML(inst.title)}</strong>
                <span class="quick-item-meta">${catLabel}</span>
            </td>
            <td><span class="badge badge-credit">${catLabel}</span></td>
            <td class="td-amount">฿${Number(inst.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="td-amount text-danger">฿${Number(inst.monthlyAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${inst.totalMonths} mo</td>
            <td>${formatMonthYear(inst.startMonth)}</td>
            <td>${statusBadge}</td>
            <td class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditInstallment('${inst.id}')" title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteInstallment('${inst.id}')" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center no-data">No installment plans</td></tr>`;
    }
}

// ==================== VIEW 6: SETTINGS ====================
function renderSettingsView() {
    document.getElementById("setting-carry-over-toggle").checked = state.carryOverEnabled;
}

// ==================== INTERACTION LOGIC & MODALS ====================
function switchView(viewId) {
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
        item.classList.remove("active");
    });
    const activeMenu = document.getElementById(`menu-${viewId}`);
    if (activeMenu) activeMenu.classList.add("active");

    document.querySelectorAll(".content-view").forEach(view => {
        view.classList.remove("active-view");
    });
    const activeView = document.getElementById(`view-${viewId}`);
    if (activeView) activeView.classList.add("active-view");

    const titleEl = document.getElementById("current-view-title");
    const subEl = document.getElementById("current-view-subtitle");

    switch (viewId) {
        case "dashboard":
            titleEl.textContent = "Dashboard";
            subEl.textContent = "Monthly Finance & Savings Overview";
            break;
        case "incomes":
            titleEl.textContent = "Incomes";
            subEl.textContent = "Salary and Additional Incomes";
            break;
        case "deductions":
            titleEl.textContent = "Savings & DCA";
            subEl.textContent = "Welfare Funds, PVD, SSO, and DCA";
            break;
        case "expenses":
            titleEl.textContent = "Expenses";
            subEl.textContent = "General Expense History";
            break;
        case "installments":
            titleEl.textContent = "Installments";
            subEl.textContent = "Credit Card Installment Plans";
            break;
        case "settings":
            titleEl.textContent = "Settings";
            subEl.textContent = "App Settings and Data Management";
            break;
    }
}

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = "slideInRight var(--transition-fast) reverse";
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
}

function closeModal(modalId) {
    document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
}

function togglePvdInputGroup(type) {
    if (type === "percent") {
        document.getElementById("pvd-val-percent-group").classList.remove("hidden");
        document.getElementById("pvd-val-fixed-group").classList.add("hidden");
    } else {
        document.getElementById("pvd-val-percent-group").classList.add("hidden");
        document.getElementById("pvd-val-fixed-group").classList.remove("hidden");
    }
}

function toggleSsoInputGroup(type) {
    if (type === "fixed") {
        document.getElementById("sso-val-fixed-group").classList.remove("hidden");
        document.getElementById("sso-auto-hint").classList.add("hidden");
    } else {
        document.getElementById("sso-val-fixed-group").classList.add("hidden");
        document.getElementById("sso-auto-hint").classList.remove("hidden");
    }
}

// Edit/Delete functions
window.openEditIncome = function (id) {
    const inc = state.incomes.find(i => i.id === id);
    if (!inc) return;

    document.getElementById("modal-income-id").value = inc.id;
    document.getElementById("modal-income-title").value = inc.title;
    document.getElementById("modal-income-amount").value = inc.amount;
    document.getElementById("modal-income-type").value = inc.type;

    const dateGroup = document.getElementById("modal-income-date-group");
    if (inc.type === "recurring") {
        dateGroup.classList.add("hidden");
        document.getElementById("modal-income-date").removeAttribute("required");
    } else {
        dateGroup.classList.remove("hidden");
        document.getElementById("modal-income-date").setAttribute("required", "");
        document.getElementById("modal-income-date").value = inc.date;
    }

    document.getElementById("income-modal-title").textContent = "Edit Income";
    openModal("modal-income");
};

window.deleteIncome = function (id) {
    if (confirm("Delete this income item?")) {
        state.incomes = state.incomes.filter(i => i.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Income deleted", "success");
    }
};

window.openEditDca = function (id) {
    const dca = state.dcaList.find(d => d.id === id);
    if (!dca) return;

    document.getElementById("modal-dca-id").value = dca.id;
    document.getElementById("modal-dca-title").value = dca.title;
    document.getElementById("modal-dca-amount").value = dca.amount;
    document.getElementById("modal-dca-category").value = dca.category;
    document.getElementById("modal-dca-type").value = dca.type;

    const dateGroup = document.getElementById("modal-dca-date-group");
    if (dca.type === "recurring") {
        dateGroup.classList.add("hidden");
        document.getElementById("modal-dca-date").removeAttribute("required");
    } else {
        dateGroup.classList.remove("hidden");
        document.getElementById("modal-dca-date").setAttribute("required", "");
        document.getElementById("modal-dca-date").value = dca.date;
    }

    document.getElementById("dca-modal-title").textContent = "Edit DCA Item";
    openModal("modal-dca");
};

window.deleteDca = function (id) {
    if (confirm("Delete this DCA item?")) {
        state.dcaList = state.dcaList.filter(d => d.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("DCA item deleted", "success");
    }
};

window.openEditExpense = function (id) {
    const exp = state.expenses.find(e => e.id === id);
    if (!exp) return;

    document.getElementById("modal-expense-id").value = exp.id;
    document.getElementById("modal-expense-title").value = exp.title;
    document.getElementById("modal-expense-amount").value = exp.amount;
    document.getElementById("modal-expense-type").value = exp.type;
    document.getElementById("modal-expense-category").value = exp.category;

    const dateGroup = document.getElementById("modal-expense-date-group");
    if (exp.type === "recurring") {
        dateGroup.classList.add("hidden");
        document.getElementById("modal-expense-date").removeAttribute("required");
    } else {
        dateGroup.classList.remove("hidden");
        document.getElementById("modal-expense-date").setAttribute("required", "");
        document.getElementById("modal-expense-date").value = exp.date;
    }

    document.getElementById("expense-modal-title").textContent = "Edit Expense";
    openModal("modal-expense");
};

window.deleteExpense = function (id) {
    if (confirm("Delete this expense?")) {
        state.expenses = state.expenses.filter(e => e.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Expense deleted", "success");
    }
};

window.openEditInstallment = function (id) {
    const inst = state.installments.find(i => i.id === id);
    if (!inst) return;

    document.getElementById("modal-installment-id").value = inst.id;
    document.getElementById("modal-installment-title").value = inst.title;
    document.getElementById("modal-installment-total-amount").value = inst.totalAmount;
    document.getElementById("modal-installment-interest").value = inst.interestRate || 0;

    const monthsSelect = document.getElementById("modal-installment-months");
    const allowedMonths = ["3", "4", "6", "10", "12", "18", "24", "36"];
    if (allowedMonths.includes(String(inst.totalMonths))) {
        monthsSelect.value = inst.totalMonths;
        document.getElementById("modal-installment-months-custom-group").classList.add("hidden");
    } else {
        monthsSelect.value = "custom";
        document.getElementById("modal-installment-months-custom-group").classList.remove("hidden");
        document.getElementById("modal-installment-months-custom").value = inst.totalMonths;
    }

    document.getElementById("modal-installment-monthly").value = inst.monthlyAmount;
    document.getElementById("modal-installment-start").value = inst.startMonth;
    document.getElementById("modal-installment-category").value = inst.category;

    document.getElementById("installment-modal-title").textContent = "Edit Installment";
    openModal("modal-installment");
};

window.deleteInstallment = function (id) {
    if (confirm("Delete this installment plan?")) {
        state.installments = state.installments.filter(i => i.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Installment deleted", "success");
    }
};

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Email Auth Logic
    const emailAuthForm = document.getElementById("email-auth-form");
    const authErrorMsg = document.getElementById("auth-error-msg");
    const logoutBtn = document.getElementById("menu-logout");
    let isLoginMode = true;

    if (emailAuthForm) {
        const btnLoginEmail = document.getElementById("btn-login-email");
        const btnToggleRegister = document.getElementById("btn-toggle-register");

        btnToggleRegister.addEventListener("click", (e) => {
            e.preventDefault();
            isLoginMode = !isLoginMode;
            if (isLoginMode) {
                btnLoginEmail.textContent = "Sign In";
                btnToggleRegister.textContent = "Register here";
                btnToggleRegister.parentElement.innerHTML = `No account? <a href="#" id="btn-toggle-register" style="color: var(--color-primary); font-weight: 500;">Register here</a>`;
            } else {
                btnLoginEmail.textContent = "Register";
                btnToggleRegister.textContent = "Sign in here";
                btnToggleRegister.parentElement.innerHTML = `Already have an account? <a href="#" id="btn-toggle-register" style="color: var(--color-primary); font-weight: 500;">Sign in here</a>`;
            }
            
            // Re-attach listener since we replaced innerHTML
            document.getElementById("btn-toggle-register").addEventListener("click", arguments.callee);
        });

        emailAuthForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const email = document.getElementById("auth-email").value;
            const password = document.getElementById("auth-password").value;

            btnLoginEmail.disabled = true;
            btnLoginEmail.textContent = "Processing...";
            authErrorMsg.style.display = "none";

            if (isLoginMode) {
                auth.signInWithEmailAndPassword(email, password)
                    .then(() => {
                        showToast("Signed in successfully", "success");
                        btnLoginEmail.disabled = false;
                        btnLoginEmail.textContent = "Sign In";
                    }).catch((error) => {
                        authErrorMsg.textContent = error.message;
                        authErrorMsg.style.display = "block";
                        btnLoginEmail.disabled = false;
                        btnLoginEmail.textContent = "Sign In";
                    });
            } else {
                auth.createUserWithEmailAndPassword(email, password)
                    .then(() => {
                        showToast("Account created successfully", "success");
                        btnLoginEmail.disabled = false;
                        btnLoginEmail.textContent = "Register";
                    }).catch((error) => {
                        authErrorMsg.textContent = error.message;
                        authErrorMsg.style.display = "block";
                        btnLoginEmail.disabled = false;
                        btnLoginEmail.textContent = "Register";
                    });
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (confirm("Sign out?")) {
                auth.signOut().then(() => {
                    showToast("Signed out", "success");
                    state = {
                        selectedMonth: state.selectedMonth,
                        baseSalary: 0, incomes: [], expenses: [], installments: [], dcaList: [],
                        welfareSettings: { pvdType: "percent", pvdValue: 3, ssoType: "auto", ssoValue: 750 },
                        carryOverEnabled: true
                    };
                    updateAppView();
                });
            }
        });
    }

    // Sidebar Navigation
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
        if (item.id === "menu-logout") return;
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const viewId = item.getAttribute("href").slice(1);
            switchView(viewId);
        });
    });

    // Month Selector
    document.getElementById("prev-month-btn").addEventListener("click", () => {
        const [year, month] = state.selectedMonth.split("-").map(Number);
        let prevM = month - 1;
        let prevY = year;
        if (prevM === 0) { prevM = 12; prevY = year - 1; }
        state.selectedMonth = `${prevY}-${String(prevM).padStart(2, '0')}`;
        updateAppView();
    });

    document.getElementById("next-month-btn").addEventListener("click", () => {
        const [year, month] = state.selectedMonth.split("-").map(Number);
        let nextM = month + 1;
        let nextY = year;
        if (nextM === 13) { nextM = 1; nextY = year + 1; }
        state.selectedMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;
        updateAppView();
    });

    // Salary Form
    document.getElementById("salary-form").addEventListener("submit", (e) => {
        e.preventDefault();
        state.baseSalary = Number(document.getElementById("input-base-salary").value);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Salary saved", "success");
    });

    // Welfare Settings
    document.getElementById("btn-save-welfare").addEventListener("click", () => {
        const isPercent = document.getElementById("pvd-type-percent").checked;
        const pvdVal = isPercent
            ? Number(document.getElementById("pvd-percent-input").value)
            : Number(document.getElementById("pvd-fixed-input").value);

        const isSsoAuto = document.getElementById("sso-type-auto").checked;
        const ssoVal = isSsoAuto ? 750 : Number(document.getElementById("sso-fixed-input").value);

        state.welfareSettings = {
            pvdType: isPercent ? "percent" : "fixed",
            pvdValue: pvdVal,
            ssoType: isSsoAuto ? "auto" : "fixed",
            ssoValue: ssoVal
        };

        saveStateToLocalStorage();
        updateAppView();
        showToast("Settings saved", "success");
    });

    document.querySelectorAll("input[name='pvd-type']").forEach(radio => {
        radio.addEventListener("change", (e) => togglePvdInputGroup(e.target.value));
    });
    document.querySelectorAll("input[name='sso-type']").forEach(radio => {
        radio.addEventListener("change", (e) => toggleSsoInputGroup(e.target.value));
    });

    // Carry Over Toggle
    document.getElementById("setting-carry-over-toggle").addEventListener("change", (e) => {
        state.carryOverEnabled = e.target.checked;
        saveStateToLocalStorage();
        updateAppView();
        showToast(`Carry-over ${state.carryOverEnabled ? 'enabled' : 'disabled'}`, "success");
    });

    // Modal Open Triggers
    document.getElementById("btn-add-income-modal").addEventListener("click", () => {
        document.getElementById("income-modal-form").reset();
        document.getElementById("modal-income-id").value = "";
        document.getElementById("income-modal-title").textContent = "Add Income";

        const today = new Date();
        const dateInput = document.getElementById("modal-income-date");
        dateInput.value = `${state.selectedMonth}-${String(today.getDate()).padStart(2, '0')}`;
        document.getElementById("modal-income-date-group").classList.remove("hidden");
        dateInput.setAttribute("required", "");

        openModal("modal-income");
    });

    document.getElementById("btn-add-expense-modal").addEventListener("click", () => {
        document.getElementById("expense-modal-form").reset();
        document.getElementById("modal-expense-id").value = "";
        document.getElementById("expense-modal-title").textContent = "Add Expense";

        const today = new Date();
        const dateInput = document.getElementById("modal-expense-date");
        dateInput.value = `${state.selectedMonth}-${String(today.getDate()).padStart(2, '0')}`;
        document.getElementById("modal-expense-date-group").classList.remove("hidden");
        dateInput.setAttribute("required", "");

        openModal("modal-expense");
    });

    document.getElementById("btn-add-dca-modal").addEventListener("click", () => {
        document.getElementById("dca-modal-form").reset();
        document.getElementById("modal-dca-id").value = "";
        document.getElementById("dca-modal-title").textContent = "Add DCA Investment";

        const today = new Date();
        const dateInput = document.getElementById("modal-dca-date");
        dateInput.value = `${state.selectedMonth}-${String(today.getDate()).padStart(2, '0')}`;
        document.getElementById("modal-dca-date-group").classList.add("hidden");
        dateInput.removeAttribute("required");

        openModal("modal-dca");
    });

    document.getElementById("btn-add-installment-modal").addEventListener("click", () => {
        document.getElementById("installment-modal-form").reset();
        document.getElementById("modal-installment-id").value = "";
        document.getElementById("modal-installment-interest").value = "0";
        document.getElementById("modal-installment-start").value = state.selectedMonth;
        document.getElementById("installment-calc-info").textContent = "Equal average per installment (0% Interest)";
        document.getElementById("installment-modal-title").textContent = "Add Installment";
        openModal("modal-installment");
    });

    // Modal Close Buttons
    document.getElementById("btn-close-income-modal").addEventListener("click", () => closeModal("modal-income"));
    document.getElementById("btn-cancel-income-modal").addEventListener("click", () => closeModal("modal-income"));

    document.getElementById("btn-close-expense-modal").addEventListener("click", () => closeModal("modal-expense"));
    document.getElementById("btn-cancel-expense-modal").addEventListener("click", () => closeModal("modal-expense"));

    document.getElementById("btn-close-dca-modal").addEventListener("click", () => closeModal("modal-dca"));
    document.getElementById("btn-cancel-dca-modal").addEventListener("click", () => closeModal("modal-dca"));

    document.getElementById("btn-close-installment-modal").addEventListener("click", () => closeModal("modal-installment"));
    document.getElementById("btn-cancel-installment-modal").addEventListener("click", () => closeModal("modal-installment"));

    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Date field toggles for recurring types
    document.getElementById("modal-income-type").addEventListener("change", (e) => {
        const dateGrp = document.getElementById("modal-income-date-group");
        const dateInput = document.getElementById("modal-income-date");
        if (e.target.value === "recurring") {
            dateGrp.classList.add("hidden");
            dateInput.removeAttribute("required");
        } else {
            dateGrp.classList.remove("hidden");
            dateInput.setAttribute("required", "");
        }
    });

    document.getElementById("modal-expense-type").addEventListener("change", (e) => {
        const dateGrp = document.getElementById("modal-expense-date-group");
        const dateInput = document.getElementById("modal-expense-date");
        if (e.target.value === "recurring") {
            dateGrp.classList.add("hidden");
            dateInput.removeAttribute("required");
        } else {
            dateGrp.classList.remove("hidden");
            dateInput.setAttribute("required", "");
        }
    });

    document.getElementById("modal-dca-type").addEventListener("change", (e) => {
        const dateGrp = document.getElementById("modal-dca-date-group");
        const dateInput = document.getElementById("modal-dca-date");
        if (e.target.value === "recurring") {
            dateGrp.classList.add("hidden");
            dateInput.removeAttribute("required");
        } else {
            dateGrp.classList.remove("hidden");
            dateInput.setAttribute("required", "");
        }
    });

    // Installment calculations
    const instMonthsSel = document.getElementById("modal-installment-months");
    const instCustomGrp = document.getElementById("modal-installment-months-custom-group");
    const instTotalInput = document.getElementById("modal-installment-total-amount");
    const instMonthlyInput = document.getElementById("modal-installment-monthly");

    instMonthsSel.addEventListener("change", (e) => {
        if (e.target.value === "custom") {
            instCustomGrp.classList.remove("hidden");
        } else {
            instCustomGrp.classList.add("hidden");
            calculateInstallmentMonthly();
        }
    });

    instTotalInput.addEventListener("input", calculateInstallmentMonthly);
    document.getElementById("modal-installment-months-custom").addEventListener("input", calculateInstallmentMonthly);
    document.getElementById("modal-installment-interest").addEventListener("input", calculateInstallmentMonthly);

    function calculateInstallmentMonthly() {
        const total = Number(instTotalInput.value);
        let months = 10;
        if (instMonthsSel.value === "custom") {
            months = Number(document.getElementById("modal-installment-months-custom").value);
        } else {
            months = Number(instMonthsSel.value);
        }

        const interestRate = Number(document.getElementById("modal-installment-interest").value) || 0;

        if (total > 0 && months > 0) {
            let grandTotal = total;
            if (interestRate > 0) {
                const totalInterest = total * (interestRate / 100) * months;
                grandTotal = total + totalInterest;
            }

            const monthly = grandTotal / months;
            instMonthlyInput.value = monthly.toFixed(2);

            if (interestRate > 0) {
                document.getElementById("installment-calc-info").textContent = `฿${monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × ${months} mo (${interestRate}%/mo)`;
            } else {
                document.getElementById("installment-calc-info").textContent = `฿${monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × ${months} mo (0% interest)`;
            }
        }
    }

    // Form Submissions
    document.getElementById("income-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-income-id").value;
        const title = document.getElementById("modal-income-title").value;
        const amount = Number(document.getElementById("modal-income-amount").value);
        const type = document.getElementById("modal-income-type").value;
        const date = document.getElementById("modal-income-date").value;

        if (id) {
            const index = state.incomes.findIndex(i => i.id === id);
            if (index !== -1) {
                state.incomes[index] = { id, title, amount, type, date: type === "recurring" ? "" : date };
            }
        } else {
            state.incomes.push({ id: generateId(), title, amount, type, date: type === "recurring" ? "" : date });
        }

        saveStateToLocalStorage();
        closeModal("modal-income");
        updateAppView();
        showToast("Income saved", "success");
    });

    document.getElementById("expense-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-expense-id").value;
        const title = document.getElementById("modal-expense-title").value;
        const amount = Number(document.getElementById("modal-expense-amount").value);
        const type = document.getElementById("modal-expense-type").value;
        const category = document.getElementById("modal-expense-category").value;
        const date = document.getElementById("modal-expense-date").value;

        if (id) {
            const index = state.expenses.findIndex(e => e.id === id);
            if (index !== -1) {
                state.expenses[index] = { id, title, amount, type, category, date: type === "recurring" ? "" : date };
            }
        } else {
            state.expenses.push({ id: generateId(), title, amount, type, category, date: type === "recurring" ? "" : date });
        }

        saveStateToLocalStorage();
        closeModal("modal-expense");
        updateAppView();
        showToast("Expense saved", "success");
    });

    document.getElementById("dca-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-dca-id").value;
        const title = document.getElementById("modal-dca-title").value;
        const amount = Number(document.getElementById("modal-dca-amount").value);
        const category = document.getElementById("modal-dca-category").value;
        const type = document.getElementById("modal-dca-type").value;
        const date = document.getElementById("modal-dca-date").value;

        if (id) {
            const index = state.dcaList.findIndex(d => d.id === id);
            if (index !== -1) {
                state.dcaList[index] = { id, title, amount, category, type, date: type === "recurring" ? "" : date };
            }
        } else {
            state.dcaList.push({ id: generateId(), title, amount, category, type, date: type === "recurring" ? "" : date });
        }

        saveStateToLocalStorage();
        closeModal("modal-dca");
        updateAppView();
        showToast("DCA saved", "success");
    });

    document.getElementById("installment-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-installment-id").value;
        const title = document.getElementById("modal-installment-title").value;
        const totalAmount = Number(document.getElementById("modal-installment-total-amount").value);
        const interestRate = Number(document.getElementById("modal-installment-interest").value) || 0;
        const monthlyAmount = Number(document.getElementById("modal-installment-monthly").value);
        const startMonth = document.getElementById("modal-installment-start").value;
        const category = document.getElementById("modal-installment-category").value;

        let totalMonths = 10;
        if (instMonthsSel.value === "custom") {
            totalMonths = Number(document.getElementById("modal-installment-months-custom").value);
        } else {
            totalMonths = Number(instMonthsSel.value);
        }

        if (id) {
            const index = state.installments.findIndex(i => i.id === id);
            if (index !== -1) {
                state.installments[index] = { id, title, totalAmount, monthlyAmount, totalMonths, startMonth, category };
            }
        } else {
            state.installments.push({ id: generateId(), title, totalAmount, monthlyAmount, totalMonths, startMonth, category });
        }

        saveStateToLocalStorage();
        closeModal("modal-installment");
        updateAppView();
        showToast("Installment saved", "success");
    });

    // Backup & Settings
    document.getElementById("btn-export-data").addEventListener("click", exportDataJSON);

    const triggerFileBtn = document.getElementById("btn-trigger-file");
    const fileInput = document.getElementById("file-import-input");
    triggerFileBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            document.getElementById("imported-file-name").textContent = file.name;
            importDataJSON(file);
        }
    });

    document.getElementById("btn-reset-data").addEventListener("click", () => {
        if (confirm("Warning: All data will be permanently deleted. Continue?")) {
            localStorage.removeItem("kimcash_state");
            state = {
                selectedMonth: "",
                baseSalary: 0, incomes: [], expenses: [], installments: [], dcaList: [],
                welfareSettings: { pvdType: "percent", pvdValue: 3, ssoType: "auto", ssoValue: 750 },
                carryOverEnabled: true
            };
            initDefaultState();
            saveStateToLocalStorage();
            updateAppView();
            showToast("All data cleared", "error");
        }
    });
}

// ==================== BACKUP UTILITIES ====================
function exportDataJSON() {
    const dataStr = JSON.stringify(state, null, 4);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `kimcash_backup_${state.selectedMonth}.json`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);

    showToast("Backup exported");
}

function importDataJSON(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsed = JSON.parse(e.target.result);

            if (
                parsed.hasOwnProperty("baseSalary") &&
                parsed.hasOwnProperty("incomes") &&
                parsed.hasOwnProperty("expenses") &&
                parsed.hasOwnProperty("installments")
            ) {
                state = { ...state, ...parsed };
                saveStateToLocalStorage();
                updateAppView();
                showToast("Data imported successfully", "success");
            } else {
                showToast("Invalid file structure", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Failed to read file", "error");
        }
    };
    reader.readAsText(file);
}

// ==================== HELPERS ====================
function generateId() {
    return Math.random().toString(36).substring(2, 11);
}

function formatCurrency(num) {
    return `฿${Number(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    const shortMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d} ${shortMonth[m - 1]} ${y}`;
}

function formatMonthYear(monthStr) {
    if (!monthStr) return "";
    const [y, m] = monthStr.split("-").map(Number);
    const shortMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${shortMonth[m - 1]} ${y}`;
}

function escapeHTML(str) {
    if (typeof str !== "string") return str;
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
