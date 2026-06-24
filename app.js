// app.js - Personal Monthly Expense Tracker Core Logic

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
// TODO: นำ Firebase Config จาก Firebase Console มาวางใน Object นี้
const firebaseConfig = {
    // นำคอมเมนต์ออกแล้วใส่ข้อมูลจริงของคุณ
    // apiKey: "AIzaSy...",
    // authDomain: "your-project.firebaseapp.com",
    // projectId: "your-project",
    // storageBucket: "your-project.appspot.com",
    // messagingSenderId: "123456789",
    // appId: "1:123456:web:123abc456def"
};

// ตรวจสอบว่าได้ตั้งค่า Firebase หรือยัง
const isFirebaseConfigured = Object.keys(firebaseConfig).length > 0;
let db = null;
let auth = null;

if (isFirebaseConfigured) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    
    // เข้าสู่ระบบแบบไม่ระบุตัวตน (Anonymous) ไปก่อน เพื่อให้ Security Rules ตรวจสอบ User ID ได้
    // (หากต้องการทำระบบ Login ด้วย Email/Google ในอนาคต ค่อยเปลี่ยนส่วนนี้)
    auth.signInAnonymously().catch((error) => {
        console.error("Firebase Auth Error:", error);
    });
}

// Colors for categories (for SVG chart and legends)
const categoryStyles = {
    food: { label: "Food & Beverage", color: "#e11d48" }, // rose-600
    housing: { label: "Housing & Utilities", color: "#d97706" }, // amber-600
    travel: { label: "Transportation & Gas", color: "#0891b2" }, // cyan-600
    personal: { label: "Personal & Shopping", color: "#2563eb" }, // blue-600
    health: { label: "Health & Medical", color: "#65a30d" }, // lime-600
    entertainment: { label: "Entertainment & Travel", color: "#c026d3" }, // fuchsia-600
    education: { label: "Education & อัปสกิล", color: "#ea580c" }, // orange-600
    family: { label: "Family & Care", color: "#7c3aed" }, // violet-600
    other: { label: "Others", color: "#64748b" }, // slate-500
    installments: { label: "Credit Card Installments", color: "#0284c7" } // sky-600
};

const THAI_MONTHS = [
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
    // Default selected month to current local month
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    state.selectedMonth = `${year}-${month}`;
}

// ==================== STORAGE OPERATIONS ====================
function saveStateToLocalStorage() {
    localStorage.setItem("fintrack_state", JSON.stringify(state));
    
    // หากเชื่อมต่อ Firebase ไว้ ให้บันทึกข้อมูลขึ้น Cloud ด้วย
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).set(state)
            .catch(err => console.error("Error saving to Firebase:", err));
    }
}

function loadStateFromLocalStorage() {
    // โหลดข้อมูลเก่าจากเครื่องก่อนเพื่อให้แอปพร้อมใช้งานทันที
    const saved = localStorage.getItem("fintrack_state");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state = { ...state, ...parsed };
        } catch (e) {
            console.error("Error parsing saved state:", e);
            showToast("ไม่สามารถโหลดข้อมูลเดิมได้ ข้อมูลได้รับความเสียหาย", "error");
        }
    }
    
    // หากเชื่อมต่อ Firebase ให้ซิงค์ข้อมูลจาก Cloud มาทับ
    if (isFirebaseConfigured && auth) {
        auth.onAuthStateChanged((user) => {
            if (user) {
                // ดึงข้อมูลครั้งแรก
                db.collection("users").doc(user.uid).get().then(doc => {
                    if (doc.exists) {
                        state = { ...state, ...doc.data() };
                        localStorage.setItem("fintrack_state", JSON.stringify(state)); // อัปเดตลงเครื่อง
                        updateAppView(); // รีเฟรชหน้าจอใหม่
                    }
                }).catch(err => console.error("Error loading from Firebase:", err));
                
                // ฟังการเปลี่ยนแปลงข้อมูลแบบ Real-time
                db.collection("users").doc(user.uid).onSnapshot(doc => {
                    if (doc.exists) {
                        state = { ...state, ...doc.data() };
                        localStorage.setItem("fintrack_state", JSON.stringify(state));
                        updateAppView();
                    }
                });
            }
        });
    }
}

// ==================== FINANCIAL CALCULATION ENGINE ====================

// Helper: Calculate month difference
function getMonthDiff(startMonthStr, targetMonthStr) {
    const [startY, startM] = startMonthStr.split("-").map(Number);
    const [targetY, targetM] = targetMonthStr.split("-").map(Number);
    return (targetY - startY) * 12 + (targetM - startM);
}

// Chronological timeline calculation
function calculateTimeline() {
    // 1. Gather all months that contain data to find the earliest
    const monthsSet = new Set([state.selectedMonth]);
    
    state.incomes.forEach(item => { if (item.date && item.type === "one-time") monthsSet.add(item.date.slice(0, 7)); });
    state.expenses.forEach(item => { if (item.date && item.type === "one-time") monthsSet.add(item.date.slice(0, 7)); });
    state.dcaList.forEach(item => { if (item.date && item.type === "one-time") monthsSet.add(item.date.slice(0, 7)); });
    state.installments.forEach(item => {
        monthsSet.add(item.startMonth);
        // Add all months in the installment duration
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
    
    // Ensure contiguous list from earliest month up to selected month
    const earliestMonth = uniqueMonths[0];
    const targetMonth = state.selectedMonth;
    
    const contiguousTimeline = [];
    let current = earliestMonth;
    
    while (current <= targetMonth) {
        contiguousTimeline.push(current);
        // Advance current by 1 month
        const [y, m] = current.split("-").map(Number);
        const nextM = m + 1;
        const nextY = y + Math.floor((nextM - 1) / 12);
        const actualNextM = String(((nextM - 1) % 12) + 1).padStart(2, '0');
        const actualNextY = y + Math.floor((nextM - 1) / 12);
        current = `${actualNextY}-${actualNextM}`;
    }

    // Results container
    const timelineResults = {};
    let carryOverBalance = 0;

    // Loop chronologically to calculate carry-overs
    contiguousTimeline.forEach(month => {
        // A. Income calculation
        let grossIncome = Number(state.baseSalary || 0); // salary is recurring
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

        // B. Welfare Deductions (Only if base salary exists)
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

        // C. DCA calculation
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

        // Net Disposable Income (income after savings/pvd/sso)
        const totalDeductions = pvdAmount + ssoAmount + totalDca;
        const disposableIncome = grossIncome - totalDeductions;

        // D. Expenses & Installments calculation
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

        // Credit Card Installments
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

        // E. Net Balance and next month Carry-over
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

        // Carry forward to next month
        carryOverBalance = netBalance;
    });

    return timelineResults;
}

// ==================== RENDERING & UI UPDATING ====================
function updateAppView() {
    const results = calculateTimeline();
    const currentData = results[state.selectedMonth] || {
        month: state.selectedMonth,
        carryOver: 0,
        grossIncome: 0,
        recurringIncome: 0,
        oneTimeIncome: 0,
        pvd: 0,
        sso: 0,
        totalDca: 0,
        activeDcaList: [],
        totalDeductions: 0,
        disposableIncome: 0,
        generalExpenses: 0,
        installmentExpenses: 0,
        totalExpenses: 0,
        activeExpensesList: [],
        activeInstallmentsList: [],
        netBalance: 0
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

// Update Month Selector Display
function updateMonthHeader() {
    const [year, month] = state.selectedMonth.split("-").map(Number);
    const thaiMonth = THAI_MONTHS[month - 1];
    const buddhistYear = year + 543;
    document.getElementById("selected-month-year").textContent = `${thaiMonth} ${buddhistYear}`;
}

// Render the 5 Core Cards on Dashboard
function renderSummaryCards(data) {
    // 1. Carry-over
    const carryValEl = document.getElementById("card-carry-value");
    const carryStatEl = document.getElementById("card-carry-status");
    carryValEl.textContent = formatCurrency(data.carryOver);
    if (data.carryOver > 0) {
        carryValEl.className = "card-value text-income";
        carryStatEl.textContent = "มีเงินออมสะสมยกมาหนุน";
    } else if (data.carryOver < 0) {
        carryValEl.className = "card-value text-danger";
        carryStatEl.textContent = "มียอดค้างชำระหักลบข้ามเดือน";
    } else {
        carryValEl.className = "card-value";
        carryStatEl.textContent = "No carry-over balance";
    }

    // 2. Gross Income
    document.getElementById("card-income-value").textContent = formatCurrency(data.grossIncome);
    document.getElementById("card-income-recurring-ratio").textContent = 
        `เงินเดือนRecurring: ${formatCurrency(state.baseSalary)} | Others: ${formatCurrency(data.oneTimeIncome)}`;

    // 3. Deductions & DCA
    document.getElementById("card-savings-value").textContent = formatCurrency(data.totalDeductions);
    document.getElementById("card-take-home-value").textContent = `เงินเหลือหลังออม: ${formatCurrency(data.disposableIncome)}`;

    // 4. Expenses & Installments
    document.getElementById("card-expense-value").textContent = formatCurrency(data.totalExpenses);
    document.getElementById("card-installment-ratio").textContent = 
        `จ่ายสด: ${formatCurrency(data.generalExpenses)} | ผ่อนบัตร: ${formatCurrency(data.installmentExpenses)}`;

    // 5. Net Balance
    const netValEl = document.getElementById("card-net-value");
    const netCardEl = netValEl.closest(".card-net");
    netValEl.textContent = formatCurrency(data.netBalance);
    if (data.netBalance >= 0) {
        netCardEl.className = "card glass-card card-net net-positive";
        document.getElementById("card-net-status").textContent = "สุขภาพการเงินปกติ ยอดจะยกไปเพิ่มเดือนหน้า";
    } else {
        netCardEl.className = "card glass-card card-net net-negative";
        document.getElementById("card-net-status").textContent = "งบติดลบ! ยอดติดลบจะยกไปหักเดือนหน้า";
    }
}

// Render Dashboard Charts & Tables
function renderDashboardDetails(data) {
    // A. Budget Progress Bars
    // Savings Rate (Total Deductions / Gross Income)
    const savingsRate = data.grossIncome > 0 ? (data.totalDeductions / data.grossIncome) * 100 : 0;
    document.getElementById("metric-savings-rate-val").textContent = `${savingsRate.toFixed(1)}%`;
    document.getElementById("metric-savings-rate-bar").style.width = `${Math.min(savingsRate, 100)}%`;

    // Expense Ratio (Total Expenses / Disposable Income)
    const expenseRatio = data.disposableIncome > 0 ? (data.totalExpenses / data.disposableIncome) * 100 : 0;
    document.getElementById("metric-expense-ratio-val").textContent = `${expenseRatio.toFixed(1)}%`;
    document.getElementById("metric-expense-ratio-bar").style.width = `${Math.min(expenseRatio, 100)}%`;
    
    // Set color indicators based on ratio levels
    const expenseRatioBar = document.getElementById("metric-expense-ratio-bar");
    if (expenseRatio > 90) {
        expenseRatioBar.style.background = "var(--color-expense)";
    } else if (expenseRatio > 70) {
        expenseRatioBar.style.background = "var(--color-warning)";
    } else {
        expenseRatioBar.style.background = "linear-gradient(90deg, var(--color-credit) 0%, var(--color-expense) 100%)";
    }

    // B. SVG Donut Chart for Expense Breakdown
    renderDonutChart(data);

    // C. Dashboard Quick Summary Tables
    // Incomes
    const incList = document.getElementById("quick-income-list");
    incList.innerHTML = "";
    if (state.baseSalary > 0) {
        incList.appendChild(createQuickLi("เงินเดือนRecurring", "รายได้หลัก", state.baseSalary, "text-income"));
    }
    const currentMonthIncomes = state.incomes.filter(i => i.type === "recurring" || i.date.slice(0, 7) === state.selectedMonth);
    currentMonthIncomes.forEach(inc => {
        incList.appendChild(createQuickLi(inc.title, inc.type === "recurring" ? "รายได้Recurring" : "รับOne-time", inc.amount, "text-income"));
    });
    if (incList.children.length === 0) {
        incList.innerHTML = `<li class="empty-item">No income data</li>`;
    }

    // Savings & DCA
    const savList = document.getElementById("quick-savings-list");
    savList.innerHTML = "";
    if (data.pvd > 0) {
        savList.appendChild(createQuickLi("กองทุนสำรองเลี้ยงชีพ (PVD)", "หักสวัสดิการ", data.pvd, "text-savings"));
    }
    if (data.sso > 0) {
        savList.appendChild(createQuickLi("ประกันสังคม (SSO)", "หักสวัสดิการ", data.sso, "text-savings"));
    }
    data.activeDcaList.forEach(dca => {
        savList.appendChild(createQuickLi(dca.title, `${categoryStyles[dca.category]?.label || 'การลงทุน'} (DCA)`, dca.computedAmount, "text-savings"));
    });
    if (savList.children.length === 0) {
        savList.innerHTML = `<li class="empty-item">No savings deductions</li>`;
    }

    // Expenses & Installments
    const expList = document.getElementById("quick-expense-list");
    expList.innerHTML = "";
    data.activeExpensesList.forEach(exp => {
        expList.appendChild(createQuickLi(exp.title, `${categoryStyles[exp.category]?.label || 'Others'}`, exp.computedAmount, "text-danger"));
    });
    data.activeInstallmentsList.forEach(inst => {
        expList.appendChild(createQuickLi(inst.title, `ผ่อนInstallment ${inst.currentInstallmentIndex}/${inst.totalMonths}`, inst.computedAmount, "text-danger"));
    });
    if (expList.children.length === 0) {
        expList.innerHTML = `<li class="empty-item">ไม่มีข้อมูลExpenses</li>`;
    }
}

function createQuickLi(name, typeText, val, textClass) {
    const li = document.createElement("li");
    li.innerHTML = `
        <div>
            <span class="quick-item-name">${name}</span>
            <span class="quick-item-meta">${typeText}</span>
        </div>
        <span class="quick-item-val ${textClass}">฿${Number(val).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
    `;
    return li;
}

// Donut Chart Drawing Logic (Native SVG)
function renderDonutChart(data) {
    const segmentsContainer = document.getElementById("donut-segments");
    const legendContainer = document.getElementById("chart-legend-container");
    
    segmentsContainer.innerHTML = "";
    legendContainer.innerHTML = "";

    // 1. Group expenses by category
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

    document.getElementById("chart-center-expense").textContent = `฿${total.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

    if (total === 0) {
        segmentsContainer.innerHTML = `<circle cx="100" cy="100" r="70" class="chart-bg" />`;
        legendContainer.innerHTML = `<div class="no-data-msg">No expenses this month</div>`;
        return;
    }

    // 2. Compute percentages and sort descending
    const items = Object.keys(catAmounts).map(catKey => {
        const amt = catAmounts[catKey];
        return {
            key: catKey,
            amount: amt,
            percentage: (amt / total) * 100,
            style: categoryStyles[catKey] || { label: "Others", color: "#94a3b8" }
        };
    }).sort((a, b) => b.amount - a.amount);

    // 3. Draw SVG segments
    const radius = 70;
    const circumference = 2 * Math.PI * radius; // 439.82
    let accumulatedPercent = 0;

    items.forEach(item => {
        const dashArrayVal = (item.percentage / 100) * circumference;
        const dashOffsetVal = circumference - dashArrayVal + (accumulatedPercent / 100) * circumference;
        
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

        // Render Legend Item
        const legendDiv = document.createElement("div");
        legendDiv.className = "legend-item";
        legendDiv.innerHTML = `
            <div class="legend-left">
                <span class="legend-dot" style="background-color: ${item.style.color}"></span>
                <span class="legend-label">${item.style.label} <span class="legend-percent">${item.percentage.toFixed(1)}%</span></span>
            </div>
            <span class="legend-val">฿${item.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        `;
        legendContainer.appendChild(legendDiv);
    });
}

// ==================== VIEW 2: INCOMES VIEW ====================
function renderIncomeView(data) {
    document.getElementById("input-base-salary").value = state.baseSalary || "";

    const tbody = document.getElementById("income-table-body");
    tbody.innerHTML = "";

    // Show Base Salary as a static row in Incomes list if it's set
    if (state.baseSalary > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>เงินเดือนRecurring (Base Salary)</strong></td>
            <td><span class="badge badge-recurring">Recurringทุกเดือน</span></td>
            <td>-</td>
            <td class="text-right td-amount text-income">฿${state.baseSalary.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.8rem;">แก้ไขที่ฟอร์มด้านบน</span></td>
        `;
        tbody.appendChild(row);
    }

    // Filter incomes active in current month
    const activeIncomes = state.incomes.filter(inc => {
        return inc.type === "recurring" || inc.date.slice(0, 7) === state.selectedMonth;
    });

    activeIncomes.forEach(inc => {
        const row = document.createElement("tr");
        const badgeClass = inc.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = inc.type === "recurring" ? "Recurringทุกเดือน" : "This Month Only";
        
        row.innerHTML = `
            <td>${escapeHTML(inc.title)}</td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td>${inc.type === "one-time" ? formatDateThai(inc.date) : "-"}</td>
            <td class="text-right td-amount text-income">฿${Number(inc.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditIncome('${inc.id}')" title="แก้ไข">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteIncome('${inc.id}')" title="ลบ">
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
        tbody.innerHTML = `<tr><td colspan="5" class="text-center no-data">No income dataเพิ่มเติมในเดือนนี้</td></tr>`;
    }
}

// ==================== VIEW 3: DEDUCTIONS & DCA VIEW ====================
function renderDeductionsView(data) {
    // 1. Setup welfares config fields
    const w = state.welfareSettings;
    
    // Provident Fund PVD
    document.getElementById("pvd-type-percent").checked = w.pvdType === "percent";
    document.getElementById("pvd-type-fixed").checked = w.pvdType === "fixed";
    document.getElementById("pvd-percent-input").value = w.pvdValue && w.pvdType === "percent" ? w.pvdValue : 3;
    document.getElementById("pvd-fixed-input").value = w.pvdValue && w.pvdType === "fixed" ? w.pvdValue : 0;
    
    togglePvdInputGroup(w.pvdType);

    // Social Security SSO
    document.getElementById("sso-type-auto").checked = w.ssoType === "auto";
    document.getElementById("sso-type-fixed").checked = w.ssoType === "fixed";
    document.getElementById("sso-fixed-input").value = w.ssoValue;
    
    toggleSsoInputGroup(w.ssoType);

    // 2. Render Deductions + DCA Table
    const tbody = document.getElementById("dca-table-body");
    tbody.innerHTML = "";

    // PVD Row
    if (data.pvd > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>Provident Fund (PVD)</strong></td>
            <td><span class="badge badge-savings">สวัสดิการพนักงาน</span></td>
            <td><span class="badge badge-recurring">Recurringทุกเดือน</span></td>
            <td>-</td>
            <td class="text-right td-amount text-savings">฿${data.pvd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.8rem;">แก้ไขสวัสดิการด้านบน</span></td>
        `;
        tbody.appendChild(row);
    }

    // SSO Row
    if (data.sso > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>Social Security (SSO)</strong></td>
            <td><span class="badge badge-savings">สวัสดิการพนักงาน</span></td>
            <td><span class="badge badge-recurring">Recurringทุกเดือน</span></td>
            <td>-</td>
            <td class="text-right td-amount text-savings">฿${data.sso.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.8rem;">แก้ไขสวัสดิการด้านบน</span></td>
        `;
        tbody.appendChild(row);
    }

    // DCA Items
    data.activeDcaList.forEach(dca => {
        const row = document.createElement("tr");
        const badgeClass = dca.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = dca.type === "recurring" ? "Recurringทุกเดือน" : "This Month Only";
        const assetLabel = categoryStyles[dca.category]?.label || "เงินลงทุน";

        row.innerHTML = `
            <td>${escapeHTML(dca.title)}</td>
            <td><span class="badge badge-savings" style="background-color: rgba(139, 92, 246, 0.15)">${assetLabel}</span></td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td>${dca.type === "one-time" ? formatDateThai(dca.date) : "-"}</td>
            <td class="text-right td-amount text-savings">฿${Number(dca.computedAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditDca('${dca.id}')" title="แก้ไข">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteDca('${dca.id}')" title="ลบ">
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
        tbody.innerHTML = `<tr><td colspan="6" class="text-center no-data">ไม่มีข้อมูลการสะสม/ DCA ในเดือนนี้</td></tr>`;
    }
}

// ==================== VIEW 4: GENERAL EXPENSES VIEW ====================
function renderExpensesView(data) {
    const tbody = document.getElementById("expense-table-body");
    tbody.innerHTML = "";

    // 1. Credit Card Installments (Render as static list rows)
    data.activeInstallmentsList.forEach(inst => {
        const row = document.createElement("tr");
        const assetLabel = categoryStyles[inst.category]?.label || "Others";
        row.innerHTML = `
            <td><strong>[Installment] ${escapeHTML(inst.title)}</strong></td>
            <td><span class="badge badge-recurring">Installment ${inst.currentInstallmentIndex}/${inst.totalMonths}</span></td>
            <td><span class="badge badge-credit">${assetLabel}</span></td>
            <td>-</td>
            <td class="text-right td-amount text-danger">฿${Number(inst.computedAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="text-center"><span class="text-muted" style="font-size: 0.8rem;">Actions in Installments Menu</span></td>
        `;
        tbody.appendChild(row);
    });

    // 2. General Expense Items
    data.activeExpensesList.forEach(exp => {
        const row = document.createElement("tr");
        const badgeClass = exp.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = exp.type === "recurring" ? "Recurring Monthly" : "This Month Only";
        const catLabel = categoryStyles[exp.category]?.label || "Others";

        row.innerHTML = `
            <td>${escapeHTML(exp.title)}</td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td><span class="badge badge-expense">${catLabel}</span></td>
            <td>${exp.type === "one-time" ? formatDateThai(exp.date) : "-"}</td>
            <td class="text-right td-amount text-danger">฿${Number(exp.computedAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
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
        tbody.innerHTML = `<tr><td colspan="6" class="text-center no-data">No general expenses this month</td></tr>`;
    }
}

// ==================== VIEW 5: INSTALLMENTS VIEW ====================
function renderInstallmentsView(data) {
    const tbody = document.getElementById("installment-table-body");
    tbody.innerHTML = "";

    state.installments.forEach(inst => {
        const row = document.createElement("tr");
        
        // Check current state for this installment in the selected month
        const diff = getMonthDiff(inst.startMonth, state.selectedMonth);
        let statusBadge = "";
        
        if (diff < 0) {
            statusBadge = `<span class="badge" style="background-color: rgba(245, 158, 11, 0.1); color: var(--color-warning);">Not started (First installment ${formatMonthYearThai(inst.startMonth)})</span>`;
        } else if (diff >= inst.totalMonths) {
            statusBadge = `<span class="badge" style="background-color: rgba(16, 185, 129, 0.1); color: var(--color-income);">Fully paid (Completed)</span>`;
        } else {
            statusBadge = `<span class="badge badge-credit">Paying (Installment ${diff + 1}/${inst.totalMonths})</span>`;
        }

        const catLabel = categoryStyles[inst.category]?.label || "Others";

        row.innerHTML = `
            <td>
                <strong>${escapeHTML(inst.title)}</strong>
                <span class="quick-item-meta">${catLabel}</span>
            </td>
            <td><span class="badge badge-credit">${catLabel}</span></td>
            <td class="td-amount">฿${Number(inst.totalAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="td-amount text-danger">฿${Number(inst.monthlyAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td>${inst.totalMonths} Months</td>
            <td>${formatMonthYearThai(inst.startMonth)}</td>
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
        tbody.innerHTML = `<tr><td colspan="8" class="text-center no-data">No installment plans in the system</td></tr>`;
    }
}

// ==================== VIEW 6: SETTINGS VIEW ====================
function renderSettingsView() {
    document.getElementById("setting-carry-over-toggle").checked = state.carryOverEnabled;
}

// ==================== INTERACTION LOGIC & MODALS ====================

function switchView(viewId) {
    // 1. Toggle Menu Items Active classes
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
        item.classList.remove("active");
    });
    const activeMenu = document.getElementById(`menu-${viewId}`);
    if (activeMenu) activeMenu.classList.add("active");

    // 2. Show Active View
    document.querySelectorAll(".content-view").forEach(view => {
        view.classList.remove("active-view");
    });
    const activeView = document.getElementById(`view-${viewId}`);
    if (activeView) activeView.classList.add("active-view");

    // 3. Update Titles & Subtitles
    const titleEl = document.getElementById("current-view-title");
    const subEl = document.getElementById("current-view-subtitle");
    
    switch (viewId) {
        case "dashboard":
            titleEl.textContent = "Dashboard";
            subEl.textContent = "Monthly Finance & Savings Overview";
            break;
        case "incomes":
            titleEl.textContent = "Incomes";
            subEl.textContent = "Recurring Salary and Additional Incomes";
            break;
        case "deductions":
            titleEl.textContent = "Savings & DCA";
            subEl.textContent = "Welfare Funds, Provident Fund, Social Security, and DCA";
            break;
        case "expenses":
            titleEl.textContent = "General Expenses";
            subEl.textContent = "Store General Expenses History";
            break;
        case "installments":
            titleEl.textContent = "ItemCredit Card Installments";
            subEl.textContent = "Manage Installment Table and Monthly Balances";
            break;
        case "settings":
            titleEl.textContent = "Settings & Backup";
            subEl.textContent = "App Calculations and Database Actions";
            break;
    }
}

// Toast System
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Auto remove after 3s
    setTimeout(() => {
        toast.style.animation = "slideInRight var(--transition-fast) reverse";
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}

// Modal opening / closing helpers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
    // Clear validation/inputs and active class
    document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
}

// Dynamic display of input groups in welfares
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

// Form Handlers & Modal Editing
window.openEditIncome = function(id) {
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

window.deleteIncome = function(id) {
    if (confirm("Are you sure you want to delete this income item?")) {
        state.incomes = state.incomes.filter(i => i.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Income deleted successfully", "success");
    }
};

window.openEditDca = function(id) {
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

window.deleteDca = function(id) {
    if (confirm("Are you sure you want to delete this DCA item?")) {
        state.dcaList = state.dcaList.filter(d => d.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("DCA item deleted successfully", "success");
    }
};

window.openEditExpense = function(id) {
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

window.deleteExpense = function(id) {
    if (confirm("Are you sure you want to delete this expense?")) {
        state.expenses = state.expenses.filter(e => e.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Expense deleted successfully", "success");
    }
};

window.openEditInstallment = function(id) {
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

    document.getElementById("installment-modal-title").textContent = "Edit Installment Item";
    openModal("modal-installment");
};

window.deleteInstallment = function(id) {
    if (confirm("Are you sure you want to delete this installment plan? (Related monthly deductions will also be removed)")) {
        state.installments = state.installments.filter(i => i.id !== id);
        saveStateToLocalStorage();
        updateAppView();
        showToast("Installment plan deleted successfully", "success");
    }
};

// ==================== EVENT LISTENERS SETUP ====================
function setupEventListeners() {
    // 1. Sidebar Navigation
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const viewId = item.getAttribute("href").slice(1);
            switchView(viewId);
        });
    });

    // 2. Month Selector buttons
    document.getElementById("prev-month-btn").addEventListener("click", () => {
        const [year, month] = state.selectedMonth.split("-").map(Number);
        let prevM = month - 1;
        let prevY = year;
        if (prevM === 0) {
            prevM = 12;
            prevY = year - 1;
        }
        state.selectedMonth = `${prevY}-${String(prevM).padStart(2, '0')}`;
        updateAppView();
    });

    document.getElementById("next-month-btn").addEventListener("click", () => {
        const [year, month] = state.selectedMonth.split("-").map(Number);
        let nextM = month + 1;
        let nextY = year;
        if (nextM === 13) {
            nextM = 1;
            nextY = year + 1;
        }
        state.selectedMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;
        updateAppView();
    });

    // 3. Salary Form Submission
    document.getElementById("salary-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const sal = Number(document.getElementById("input-base-salary").value);
        state.baseSalary = sal;
        saveStateToLocalStorage();
        updateAppView();
        showToast("Base salary saved successfully", "success");
    });

    // 4. Welfare Settings Save
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
        showToast("Welfare deduction system saved successfully", "success");
    });

    // Toggle welfare configuration UI inputs dynamically
    document.querySelectorAll("input[name='pvd-type']").forEach(radio => {
        radio.addEventListener("change", (e) => togglePvdInputGroup(e.target.value));
    });
    document.querySelectorAll("input[name='sso-type']").forEach(radio => {
        radio.addEventListener("change", (e) => toggleSsoInputGroup(e.target.value));
    });

    // 5. Carry Over settings Toggle
    document.getElementById("setting-carry-over-toggle").addEventListener("change", (e) => {
        state.carryOverEnabled = e.target.checked;
        saveStateToLocalStorage();
        updateAppView();
        showToast(`Toggle Carry-Over System: ${state.carryOverEnabled ? 'Enabled' : 'Disabled'}`, "success");
    });

    // 6. Modals Open triggers
    document.getElementById("btn-add-income-modal").addEventListener("click", () => {
        document.getElementById("income-modal-form").reset();
        document.getElementById("modal-income-id").value = "";
        document.getElementById("income-modal-title").textContent = "Add Additional Income";
        
        // Auto fill date with first day of selectedMonth or current day
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
        document.getElementById("expense-modal-title").textContent = "Save General Expense";
        
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
        document.getElementById("dca-modal-title").textContent = "Save DCA Item";
        
        const today = new Date();
        const dateInput = document.getElementById("modal-dca-date");
        dateInput.value = `${state.selectedMonth}-${String(today.getDate()).padStart(2, '0')}`;
        document.getElementById("modal-dca-date-group").classList.add("hidden");
        dateInput.removeAttribute("required"); // defaults to recurring

        openModal("modal-dca");
    });

    document.getElementById("btn-add-installment-modal").addEventListener("click", () => {
        document.getElementById("installment-modal-form").reset();
        document.getElementById("modal-installment-id").value = "";
        document.getElementById("modal-installment-interest").value = "0";
        document.getElementById("modal-installment-start").value = state.selectedMonth;
        document.getElementById("installment-calc-info").textContent = "Equal average per installment (0% Interest)";
        document.getElementById("installment-modal-title").textContent = "Add Credit Card Installment";
        openModal("modal-installment");
    });

    // 7. Modals close buttons
    document.getElementById("btn-close-income-modal").addEventListener("click", () => closeModal("modal-income"));
    document.getElementById("btn-cancel-income-modal").addEventListener("click", () => closeModal("modal-income"));
    
    document.getElementById("btn-close-expense-modal").addEventListener("click", () => closeModal("modal-expense"));
    document.getElementById("btn-cancel-expense-modal").addEventListener("click", () => closeModal("modal-expense"));
    
    document.getElementById("btn-close-dca-modal").addEventListener("click", () => closeModal("modal-dca"));
    document.getElementById("btn-cancel-dca-modal").addEventListener("click", () => closeModal("modal-dca"));

    document.getElementById("btn-close-installment-modal").addEventListener("click", () => closeModal("modal-installment"));
    document.getElementById("btn-cancel-installment-modal").addEventListener("click", () => closeModal("modal-installment"));

    // Close modals on clicking overlay backdrop
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Hide date fields for recurring types in modals
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

    // Installment month dropdown calculations helper
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
                document.getElementById("installment-calc-info").textContent = `Installment: ฿${monthly.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} for ${months} Months (Rate: ${interestRate}%/month)`;
            } else {
                document.getElementById("installment-calc-info").textContent = `Equal average per installment of ฿${monthly.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} for ${months} Months (0% Interest)`;
            }
        }
    }

    // Modal submit listeners
    // 1. Income Form Save
    document.getElementById("income-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-income-id").value;
        const title = document.getElementById("modal-income-title").value;
        const amount = Number(document.getElementById("modal-income-amount").value);
        const type = document.getElementById("modal-income-type").value;
        const date = document.getElementById("modal-income-date").value;

        if (id) {
            // Edit existing
            const index = state.incomes.findIndex(i => i.id === id);
            if (index !== -1) {
                state.incomes[index] = { id, title, amount, type, date: type === "recurring" ? "" : date };
            }
        } else {
            // Create new
            const newInc = {
                id: generateId(),
                title,
                amount,
                type,
                date: type === "recurring" ? "" : date
            };
            state.incomes.push(newInc);
        }

        saveStateToLocalStorage();
        closeModal("modal-income");
        updateAppView();
        showToast("Income saved successfully", "success");
    });

    // 2. Expense Form Save
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
            const newExp = {
                id: generateId(),
                title,
                amount,
                type,
                category,
                date: type === "recurring" ? "" : date
            };
            state.expenses.push(newExp);
        }

        saveStateToLocalStorage();
        closeModal("modal-expense");
        updateAppView();
        showToast("Expense saved successfully", "success");
    });

    // 3. DCA Form Save
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
            const newDca = {
                id: generateId(),
                title,
                amount,
                category,
                type,
                date: type === "recurring" ? "" : date
            };
            state.dcaList.push(newDca);
        }

        saveStateToLocalStorage();
        closeModal("modal-dca");
        updateAppView();
        showToast("DCA saved successfully", "success");
    });

    // 4. Installment Form Save
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
            const newInst = {
                id: generateId(),
                title,
                totalAmount,
                monthlyAmount,
                totalMonths,
                startMonth,
                category
            };
            state.installments.push(newInst);
        }

        saveStateToLocalStorage();
        closeModal("modal-installment");
        updateAppView();
        showToast("Installment table saved successfully", "success");
    });

    // 8. Settings View Backup Buttons
    document.getElementById("btn-export-data").addEventListener("click", exportDataJSON);
    
    // File upload triggers
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
        if (confirm("Warning: All financial data, installments, and savings will be permanently deleted. This cannot be undone. Do you wish to continue?")) {
            localStorage.removeItem("fintrack_state");
            state = {
                selectedMonth: "",
                baseSalary: 0,
                incomes: [],
                expenses: [],
                installments: [],
                dcaList: [],
                welfareSettings: { pvdType: "percent", pvdValue: 3, ssoType: "auto", ssoValue: 750 },
                carryOverEnabled: true
            };
            initDefaultState();
            saveStateToLocalStorage();
            updateAppView();
            showToast("Database wiped successfully", "error");
        }
    });
}

// JSON Backup Utilities
function exportDataJSON() {
    const dataStr = JSON.stringify(state, null, 4);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `fintrack_backup_${state.selectedMonth}.json`;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
    
    showToast("Backup file exported successfully");
}

function importDataJSON(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            
            // Check essential structures to validate backup structure
            if (
                parsed.hasOwnProperty("baseSalary") && 
                parsed.hasOwnProperty("incomes") && 
                parsed.hasOwnProperty("expenses") && 
                parsed.hasOwnProperty("installments")
            ) {
                state = { ...state, ...parsed };
                saveStateToLocalStorage();
                updateAppView();
                showToast("Backup data imported successfully!", "success");
            } else {
                showToast("Invalid file structure", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Cannot read JSON file or file is corrupted", "error");
        }
    };
    reader.readAsText(file);
}

// ==================== HELPERS ====================
function generateId() {
    return Math.random().toString(36).substring(2, 11);
}

function formatCurrency(num) {
    return `฿${Number(num).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function formatDateThai(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    const shortMonth = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    return `${d} ${shortMonth[m - 1]} ${y}`; // Returns e.g. "22 มิ.ย. 69"
}

function formatMonthYearThai(monthStr) {
    if (!monthStr) return "";
    const [y, m] = monthStr.split("-").map(Number);
    const shortMonth = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    return `${shortMonth[m - 1]} ${y}`; // Returns e.g. "มิ.ย. 2569"
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
