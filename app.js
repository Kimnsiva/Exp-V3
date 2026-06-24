// app.js - KimCash Personal Finance Tracker

// ==================== STATE MANAGEMENT ====================
let state = {
    selectedMonth: "", // YYYY-MM
    baseSalary: 0,
    incomes: [],       // { id, title, amount, type: 'one-time'|'recurring', date }
    expenses: [],      // { id, title, amount, type: 'one-time'|'recurring', category, date }
    installments: [],  // { id, title, totalAmount, monthlyAmount, totalMonths, startMonth, category }
    dcaList: [],       // { id, title, amount, type: 'one-time'|'recurring', category, date }
    creditCards: [],   // { id, name, bank, limit }
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
        const forceSyncBtn = document.getElementById("menu-force-sync");
        const mobileLogoutBtn = document.getElementById("mobile-logout");
        const mobileForceSyncBtn = document.getElementById("mobile-force-sync");
        const settingsSessionPanel = document.getElementById("settings-session-panel");

        const appContainer = document.getElementById("app-container");

        if (user) {
            if (overlay) overlay.style.display = "none";
            if (appContainer) appContainer.style.display = "";
            if (logoutBtn) logoutBtn.style.display = "flex";
            if (forceSyncBtn) forceSyncBtn.style.display = "flex";
            if (mobileLogoutBtn) mobileLogoutBtn.style.display = "flex";
            if (mobileForceSyncBtn) mobileForceSyncBtn.style.display = "flex";
            if (settingsSessionPanel) settingsSessionPanel.style.display = "block";

            const userRef = db.collection("users").doc(user.uid);

            // Migration from legacy single document format to subcollections or initial upload
            userRef.get().then(doc => {
                const needsMigration = doc.exists && !doc.data().migratedToSubcollections;
                const isEmptyFirestore = !doc.exists;

                if (needsMigration || isEmptyFirestore) {
                    console.log("Initializing/Migrating data to subcollections...");
                    const batch = db.batch();
                    
                    // Retrieve items from local state (loaded from LocalStorage)
                    const dataObj = doc.exists ? doc.data() : state;

                    const incomesList = doc.exists ? dataObj.incomes : state.incomes;
                    const expensesList = doc.exists ? dataObj.expenses : state.expenses;
                    const installmentsList = doc.exists ? dataObj.installments : state.installments;
                    const dcaList = doc.exists ? dataObj.dcaList : state.dcaList;
                    const creditCardsList = state.creditCards;

                    if (Array.isArray(incomesList)) {
                        incomesList.forEach(item => {
                            const ref = userRef.collection("incomes").doc(item.id || generateId());
                            batch.set(ref, item);
                        });
                    }
                    if (Array.isArray(expensesList)) {
                        expensesList.forEach(item => {
                            const ref = userRef.collection("expenses").doc(item.id || generateId());
                            batch.set(ref, item);
                        });
                    }
                    if (Array.isArray(installmentsList)) {
                        installmentsList.forEach(item => {
                            const ref = userRef.collection("installments").doc(item.id || generateId());
                            batch.set(ref, item);
                        });
                    }
                    if (Array.isArray(dcaList)) {
                        dcaList.forEach(item => {
                            const ref = userRef.collection("dcaList").doc(item.id || generateId());
                            batch.set(ref, item);
                        });
                    }
                    if (Array.isArray(creditCardsList)) {
                        creditCardsList.forEach(item => {
                            const ref = userRef.collection("creditCards").doc(item.id || generateId());
                            batch.set(ref, item);
                        });
                    }

                    // Save settings and mark as migrated
                    batch.set(userRef, {
                        migratedToSubcollections: true,
                        baseSalary: state.baseSalary,
                        welfareSettings: state.welfareSettings,
                        carryOverEnabled: state.carryOverEnabled,
                        incomes: firebase.firestore.FieldValue.delete(),
                        expenses: firebase.firestore.FieldValue.delete(),
                        installments: firebase.firestore.FieldValue.delete(),
                        dcaList: firebase.firestore.FieldValue.delete()
                    }, { merge: true });

                    batch.commit()
                        .then(() => console.log("Initial Firestore upload/migration complete!"))
                        .catch(err => console.error("Error performing initial upload:", err));
                }
            }).catch(err => console.error("Error reading user doc for migration:", err));

            // Set up real-time subcollection listeners
            // 1. Settings / Main doc
            userRef.onSnapshot(doc => {
                if (doc.exists) {
                    const data = doc.data();
                    state.baseSalary = data.baseSalary !== undefined ? data.baseSalary : state.baseSalary;
                    state.welfareSettings = data.welfareSettings || state.welfareSettings;
                    state.carryOverEnabled = data.carryOverEnabled !== undefined ? data.carryOverEnabled : state.carryOverEnabled;
                    saveLocalAndRender();
                }
            }, err => console.error("Error listening to user settings:", err));

            // 2. Incomes
            userRef.collection("incomes").onSnapshot(snapshot => {
                state.incomes = [];
                snapshot.forEach(doc => {
                    state.incomes.push({ id: doc.id, ...doc.data() });
                });
                saveLocalAndRender();
            }, err => console.error("Error listening to incomes:", err));

            // 3. Expenses
            userRef.collection("expenses").onSnapshot(snapshot => {
                state.expenses = [];
                snapshot.forEach(doc => {
                    state.expenses.push({ id: doc.id, ...doc.data() });
                });
                saveLocalAndRender();
            }, err => console.error("Error listening to expenses:", err));

            // 4. Installments
            userRef.collection("installments").onSnapshot(snapshot => {
                state.installments = [];
                snapshot.forEach(doc => {
                    state.installments.push({ id: doc.id, ...doc.data() });
                });
                saveLocalAndRender();
            }, err => console.error("Error listening to installments:", err));

            // 5. DCA List
            userRef.collection("dcaList").onSnapshot(snapshot => {
                state.dcaList = [];
                snapshot.forEach(doc => {
                    state.dcaList.push({ id: doc.id, ...doc.data() });
                });
                saveLocalAndRender();
            }, err => console.error("Error listening to DCA:", err));

            // 6. Credit Cards
            userRef.collection("creditCards").onSnapshot(snapshot => {
                state.creditCards = [];
                snapshot.forEach(doc => {
                    state.creditCards.push({ id: doc.id, ...doc.data() });
                });
                saveLocalAndRender();
            }, err => console.error("Error listening to credit cards:", err));

        } else {
            if (overlay) overlay.style.display = "flex";
            if (appContainer) appContainer.style.display = "none";
            if (logoutBtn) logoutBtn.style.display = "none";
            if (forceSyncBtn) forceSyncBtn.style.display = "none";
            if (mobileLogoutBtn) mobileLogoutBtn.style.display = "none";
            if (mobileForceSyncBtn) mobileForceSyncBtn.style.display = "none";
            if (settingsSessionPanel) settingsSessionPanel.style.display = "none";
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
    if (!isFirebaseConfigured) {
        const overlay = document.getElementById("auth-overlay");
        const appContainer = document.getElementById("app-container");
        if (overlay) overlay.style.display = "none";
        if (appContainer) appContainer.style.display = "";
    }
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
function saveLocalAndRender() {
    localStorage.setItem("kimcash_state", JSON.stringify(state));
    updateAppView();
}

function saveStateToLocalStorage() {
    localStorage.setItem("kimcash_state", JSON.stringify(state));

    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).set({
            baseSalary: state.baseSalary,
            welfareSettings: state.welfareSettings,
            carryOverEnabled: state.carryOverEnabled
        }, { merge: true }).catch(err => console.error("Error saving settings to Firebase:", err));
    }
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem("kimcash_state");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state = { ...state, ...parsed };
            state.creditCards = state.creditCards || [];
        } catch (e) {
            console.error("Error parsing saved state:", e);
            showToast("Failed to load saved data", "error");
        }
    } else {
        state.creditCards = [];
    }
}

// ==================== FIREBASE CRUD WRAPPERS ====================
function saveIncomeFirebase(income) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("incomes").doc(income.id).set(income)
            .catch(err => console.error("Error saving income to Firebase:", err));
    } else {
        const index = state.incomes.findIndex(i => i.id === income.id);
        if (index !== -1) state.incomes[index] = income;
        else state.incomes.push(income);
        saveLocalAndRender();
    }
}

function deleteIncomeFirebase(id) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("incomes").doc(id).delete()
            .catch(err => console.error("Error deleting income from Firebase:", err));
    } else {
        state.incomes = state.incomes.filter(i => i.id !== id);
        saveLocalAndRender();
    }
}

function saveExpenseFirebase(expense) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("expenses").doc(expense.id).set(expense)
            .catch(err => console.error("Error saving expense to Firebase:", err));
    } else {
        const index = state.expenses.findIndex(e => e.id === expense.id);
        if (index !== -1) state.expenses[index] = expense;
        else state.expenses.push(expense);
        saveLocalAndRender();
    }
}

function deleteExpenseFirebase(id) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("expenses").doc(id).delete()
            .catch(err => console.error("Error deleting expense from Firebase:", err));
    } else {
        state.expenses = state.expenses.filter(e => e.id !== id);
        saveLocalAndRender();
    }
}

function saveInstallmentFirebase(inst) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("installments").doc(inst.id).set(inst)
            .catch(err => console.error("Error saving installment to Firebase:", err));
    } else {
        const index = state.installments.findIndex(i => i.id === inst.id);
        if (index !== -1) state.installments[index] = inst;
        else state.installments.push(inst);
        saveLocalAndRender();
    }
}

function deleteInstallmentFirebase(id) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("installments").doc(id).delete()
            .catch(err => console.error("Error deleting installment from Firebase:", err));
    } else {
        state.installments = state.installments.filter(i => i.id !== id);
        saveLocalAndRender();
    }
}

function saveDcaFirebase(dca) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("dcaList").doc(dca.id).set(dca)
            .catch(err => console.error("Error saving DCA to Firebase:", err));
    } else {
        const index = state.dcaList.findIndex(d => d.id === dca.id);
        if (index !== -1) state.dcaList[index] = dca;
        else state.dcaList.push(dca);
        saveLocalAndRender();
    }
}

function deleteDcaFirebase(id) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("dcaList").doc(id).delete()
            .catch(err => console.error("Error deleting DCA from Firebase:", err));
    } else {
        state.dcaList = state.dcaList.filter(d => d.id !== id);
        saveLocalAndRender();
    }
}

function saveCreditCardFirebase(card) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("creditCards").doc(card.id).set(card)
            .catch(err => console.error("Error saving credit card to Firebase:", err));
    } else {
        const index = state.creditCards.findIndex(c => c.id === card.id);
        if (index !== -1) state.creditCards[index] = card;
        else state.creditCards.push(card);
        saveLocalAndRender();
    }
}

function deleteCreditCardFirebase(id) {
    if (isFirebaseConfigured && db && auth && auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).collection("creditCards").doc(id).delete()
            .catch(err => console.error("Error deleting credit card from Firebase:", err));
    } else {
        state.creditCards = state.creditCards.filter(c => c.id !== id);
        saveLocalAndRender();
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

    state.incomes.forEach(item => { if (item.date) monthsSet.add(item.date.slice(0, 7)); });
    state.expenses.forEach(item => { if (item.date) monthsSet.add(item.date.slice(0, 7)); });
    state.dcaList.forEach(item => { if (item.date) monthsSet.add(item.date.slice(0, 7)); });
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
        const baseSalStart = state.baseSalaryStartMonth || "";
        const isBaseActive = month >= baseSalStart;

        let grossIncome = isBaseActive ? Number(state.baseSalary || 0) : 0;
        let recurringIncome = isBaseActive ? Number(state.baseSalary || 0) : 0;
        let oneTimeIncome = 0;

        state.incomes.forEach(inc => {
            const amt = Number(inc.amount);
            const startMonth = inc.date ? inc.date.slice(0, 7) : "";
            if (inc.type === "recurring" && month >= startMonth) {
                grossIncome += amt;
                recurringIncome += amt;
            } else if (inc.type === "one-time" && inc.date.slice(0, 7) === month) {
                grossIncome += amt;
                oneTimeIncome += amt;
            }
        });

        let pvdAmount = 0;
        let ssoAmount = 0;

        if (isBaseActive && state.baseSalary > 0) {
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
            const startMonth = dca.date ? dca.date.slice(0, 7) : "";
            if (dca.type === "recurring" && month >= startMonth) {
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
            const startMonth = exp.date ? exp.date.slice(0, 7) : "";
            if (exp.type === "recurring" && month >= startMonth) {
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
    renderCreditCardsTable();
    populateCardDropdown();
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
    document.getElementById("input-base-salary-start").value = state.baseSalaryStartMonth || state.selectedMonth;

    const tbody = document.getElementById("income-table-body");
    tbody.innerHTML = "";

    if (state.baseSalary > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td data-label="Item"><strong>Base Salary</strong></td>
            <td data-label="Type"><span class="badge badge-recurring">Recurring</span></td>
            <td data-label="Date">${state.baseSalaryStartMonth ? formatDate(state.baseSalaryStartMonth + "-01").slice(3) : "—"}</td>
            <td data-label="Amount" class="text-right td-amount text-income">฿${state.baseSalary.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Edit above</span></td>
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
            <td data-label="Item">${escapeHTML(inc.title)}</td>
            <td data-label="Type"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td data-label="Date">${inc.date ? formatDate(inc.date) : "—"}</td>
            <td data-label="Amount" class="text-right td-amount text-income">฿${Number(inc.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center">
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
            <td data-label="Item"><strong>Provident Fund (PVD)</strong></td>
            <td data-label="Category"><span class="badge badge-savings">Welfare</span></td>
            <td data-label="Type"><span class="badge badge-recurring">Recurring</span></td>
            <td data-label="Date">—</td>
            <td data-label="Amount" class="text-right td-amount text-savings">฿${data.pvd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Edit above</span></td>
        `;
        tbody.appendChild(row);
    }

    if (data.sso > 0) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td data-label="Item"><strong>Social Security (SSO)</strong></td>
            <td data-label="Category"><span class="badge badge-savings">Welfare</span></td>
            <td data-label="Type"><span class="badge badge-recurring">Recurring</span></td>
            <td data-label="Date">—</td>
            <td data-label="Amount" class="text-right td-amount text-savings">฿${data.sso.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Edit above</span></td>
        `;
        tbody.appendChild(row);
    }

    data.activeDcaList.forEach(dca => {
        const row = document.createElement("tr");
        const badgeClass = dca.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = dca.type === "recurring" ? "Recurring" : "One-time";
        const assetLabel = categoryStyles[dca.category]?.label || "Investment";

        row.innerHTML = `
            <td data-label="Item">${escapeHTML(dca.title)}</td>
            <td data-label="Category"><span class="badge badge-savings" style="background-color: rgba(139, 92, 246, 0.1)">${assetLabel}</span></td>
            <td data-label="Type"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td data-label="Date">${dca.date ? formatDate(dca.date) : "—"}</td>
            <td data-label="Amount" class="text-right td-amount text-savings">฿${Number(dca.computedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center">
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
            <td data-label="Item"><strong>[Installment] ${escapeHTML(inst.title)}</strong></td>
            <td data-label="Type"><span class="badge badge-recurring">Installment ${inst.currentInstallmentIndex}/${inst.totalMonths}</span></td>
            <td data-label="Category"><span class="badge badge-credit">${assetLabel}</span></td>
            <td data-label="Date">—</td>
            <td data-label="Amount" class="text-right td-amount text-danger">฿${Number(inst.computedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center"><span class="text-muted" style="font-size: 0.7rem;">Manage in Installments</span></td>
        `;
        tbody.appendChild(row);
    });

    data.activeExpensesList.forEach(exp => {
        const row = document.createElement("tr");
        const badgeClass = exp.type === "recurring" ? "badge-recurring" : "badge-one-time";
        const badgeLabel = exp.type === "recurring" ? "Recurring" : "One-time";
        const catLabel = categoryStyles[exp.category]?.label || "Others";

        row.innerHTML = `
            <td data-label="Item">${escapeHTML(exp.title)}</td>
            <td data-label="Type"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td data-label="Category"><span class="badge badge-expense">${catLabel}</span></td>
            <td data-label="Date">${exp.date ? formatDate(exp.date) : "—"}</td>
            <td data-label="Amount" class="text-right td-amount text-danger">฿${Number(exp.computedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Actions" class="text-center">
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
        const card = state.creditCards ? state.creditCards.find(c => c.id === inst.creditor) : null;
        const cardDisplay = card ? card.name : (inst.creditor || '—');

        row.innerHTML = `
            <td data-label="Product/Service">
                <strong>${escapeHTML(inst.title)}</strong>
                <span class="quick-item-meta">${catLabel}</span>
            </td>
            <td data-label="Creditor / Card">${escapeHTML(cardDisplay)}</td>
            <td data-label="Category"><span class="badge badge-credit">${catLabel}</span></td>
            <td data-label="Total Value" class="td-amount">฿${Number(inst.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Monthly" class="td-amount text-danger">฿${Number(inst.monthlyAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Months">${inst.totalMonths} mo</td>
            <td data-label="Start">${formatMonthYear(inst.startMonth)}</td>
            <td data-label="Status">${statusBadge}</td>
            <td data-label="Actions" class="text-center">
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
        tbody.innerHTML = `<tr><td colspan="9" class="text-center no-data">No installment plans</td></tr>`;
    }
}

// ==================== VIEW: CREDIT CARDS ====================
function renderCreditCardsTable() {
    const tbody = document.getElementById("credit-card-table-body");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    state.creditCards.forEach(card => {
        const row = document.createElement("tr");
        const limitDisplay = card.limit ? `฿${Number(card.limit).toLocaleString()}` : "—";
        
        row.innerHTML = `
            <td data-label="Card Name"><strong>${escapeHTML(card.name)}</strong></td>
            <td data-label="Bank / Issuer">${escapeHTML(card.bank || '—')}</td>
            <td data-label="Limit" class="text-right">${limitDisplay}</td>
            <td data-label="Actions" class="text-center">
                <button class="btn-action-icon btn-edit" onclick="openEditCreditCard('${card.id}')" title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="btn-action-icon btn-delete" onclick="deleteCreditCard('${card.id}')" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    if (state.creditCards.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center no-data">No credit cards added</td></tr>`;
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
    if (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("active");
    } else {
        document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
    }
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
        deleteIncomeFirebase(id);
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
        deleteDcaFirebase(id);
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
        deleteExpenseFirebase(id);
        showToast("Expense deleted", "success");
    }
};

window.openEditInstallment = function (id) {
    const inst = state.installments.find(i => i.id === id);
    if (!inst) return;

    document.getElementById("modal-installment-id").value = inst.id;
    document.getElementById("modal-installment-title").value = inst.title;
    populateCardDropdown(inst.creditor);
    document.getElementById("modal-installment-creditor").value = inst.creditor || "";
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
    
    const interestRate = inst.interestRate || 0;
    if (interestRate > 0) {
        document.getElementById("installment-calc-info").textContent = `Installment: ฿${Number(inst.monthlyAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} for ${inst.totalMonths} Months (Rate: ${interestRate}%/month)`;
    } else {
        document.getElementById("installment-calc-info").textContent = `Equal average per installment of ฿${Number(inst.monthlyAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} for ${inst.totalMonths} Months (0% Interest)`;
    }

    document.getElementById("modal-installment-start").value = inst.startMonth;
    document.getElementById("modal-installment-category").value = inst.category;

    document.getElementById("installment-modal-title").textContent = "Edit Installment";
    openModal("modal-installment");
};

window.deleteInstallment = function (id) {
    if (confirm("Delete this installment plan?")) {
        deleteInstallmentFirebase(id);
        showToast("Installment deleted", "success");
    }
};

window.openEditCreditCard = function (id) {
    const card = state.creditCards.find(c => c.id === id);
    if (!card) return;

    document.getElementById("modal-card-id").value = card.id;
    document.getElementById("modal-card-name").value = card.name;
    document.getElementById("modal-card-bank").value = card.bank || "";
    document.getElementById("modal-card-limit").value = card.limit || "";

    document.getElementById("credit-card-modal-title").textContent = "Edit Credit Card";
    openModal("modal-credit-card");
};

window.deleteCreditCard = function (id) {
    if (confirm("Delete this credit card? Existing installments on this card will lose their card linkage.")) {
        deleteCreditCardFirebase(id);
        showToast("Credit card deleted", "success");
    }
};

function populateCardDropdown(extraValue) {
    const select = document.getElementById("modal-installment-creditor");
    if (!select) return;
    
    const selectedVal = extraValue || select.value;
    select.innerHTML = '<option value="" disabled selected>Select Card</option>';
    
    let extraValueMatched = false;
    
    state.creditCards.forEach(card => {
        const option = document.createElement("option");
        option.value = card.id;
        option.textContent = `${card.name} (${card.bank || 'No Bank'})`;
        select.appendChild(option);
        if (selectedVal && card.id === selectedVal) {
            extraValueMatched = true;
        }
    });
    
    if (selectedVal && !extraValueMatched && selectedVal !== "") {
        const option = document.createElement("option");
        option.value = selectedVal;
        option.textContent = selectedVal;
        select.appendChild(option);
    }
    
    if (selectedVal) {
        select.value = selectedVal;
    }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Email Auth Logic
    const emailAuthForm = document.getElementById("email-auth-form");
    const authErrorMsg = document.getElementById("auth-error-msg");
    const logoutBtn = document.getElementById("menu-logout");
    let isLoginMode = true;

    if (emailAuthForm) {
        const btnLoginEmail = document.getElementById("btn-login-email");

        emailAuthForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const email = document.getElementById("auth-email").value;
            const password = document.getElementById("auth-password").value;

            btnLoginEmail.disabled = true;
            btnLoginEmail.textContent = "Processing...";
            authErrorMsg.style.display = "none";

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
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }
    
    const mobileLogoutBtn = document.getElementById("mobile-logout");
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener("click", handleLogout);
    }

    const settingsLogoutBtn = document.getElementById("settings-logout");
    if (settingsLogoutBtn) {
        settingsLogoutBtn.addEventListener("click", handleLogout);
    }

    function handleLogout(e) {
        e.preventDefault();
        if (confirm("Sign out?")) {
            auth.signOut().then(() => {
                showToast("Signed out", "success");
                state = {
                    selectedMonth: state.selectedMonth,
                    baseSalary: 0, incomes: [], expenses: [], installments: [], dcaList: [], creditCards: [],
                    welfareSettings: { pvdType: "percent", pvdValue: 3, ssoType: "auto", ssoValue: 750 },
                    carryOverEnabled: true
                };
                updateAppView();
            });
        }
    }

    const forceSyncBtn = document.getElementById("menu-force-sync");
    const mobileForceSyncBtn = document.getElementById("mobile-force-sync");
    
    function handleForceSync(e) {
        e.preventDefault();
        saveStateToLocalStorage();
        showToast("Force synced data to cloud", "success");
    }

    if (forceSyncBtn) forceSyncBtn.addEventListener("click", handleForceSync);
    if (mobileForceSyncBtn) mobileForceSyncBtn.addEventListener("click", handleForceSync);
    
    const settingsForceSyncBtn = document.getElementById("settings-force-sync");
    if (settingsForceSyncBtn) {
        settingsForceSyncBtn.addEventListener("click", handleForceSync);
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
        state.baseSalaryStartMonth = document.getElementById("input-base-salary-start").value;
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
        document.getElementById("modal-installment-months-custom-group").classList.add("hidden");
        document.getElementById("installment-calc-info").textContent = "Equal average per installment (0% Interest)";
        document.getElementById("installment-modal-title").textContent = "Add Installment";
        populateCardDropdown();
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

    // Credit Card Modal Listeners
    document.getElementById("btn-add-card-modal").addEventListener("click", () => {
        document.getElementById("credit-card-modal-form").reset();
        document.getElementById("modal-card-id").value = "";
        document.getElementById("credit-card-modal-title").textContent = "Add Credit Card";
        openModal("modal-credit-card");
    });

    document.getElementById("btn-close-card-modal").addEventListener("click", () => closeModal("modal-credit-card"));
    document.getElementById("btn-cancel-card-modal").addEventListener("click", () => closeModal("modal-credit-card"));

    document.getElementById("credit-card-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-card-id").value || generateId();
        const name = document.getElementById("modal-card-name").value;
        const bank = document.getElementById("modal-card-bank").value;
        const limitVal = document.getElementById("modal-card-limit").value;
        const limit = limitVal ? Number(limitVal) : null;

        saveCreditCardFirebase({ id, name, bank, limit });
        closeModal("modal-credit-card");
        showToast("Credit card saved", "success");
    });

    const linkAddCard = document.getElementById("link-add-card-from-modal");
    if (linkAddCard) {
        linkAddCard.addEventListener("click", (e) => {
            e.preventDefault();
            document.getElementById("credit-card-modal-form").reset();
            document.getElementById("modal-card-id").value = "";
            document.getElementById("credit-card-modal-title").textContent = "Add Credit Card";
            openModal("modal-credit-card");
        });
    }

    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Date field is always shown for both one-time and recurring items (to act as Start Date)
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
        }
        calculateInstallmentMonthly();
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
        const id = document.getElementById("modal-income-id").value || generateId();
        const title = document.getElementById("modal-income-title").value;
        const amount = Number(document.getElementById("modal-income-amount").value);
        const type = document.getElementById("modal-income-type").value;
        const date = document.getElementById("modal-income-date").value;

        saveIncomeFirebase({ id, title, amount, type, date });
        closeModal("modal-income");
        showToast("Income saved", "success");
    });

    document.getElementById("expense-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-expense-id").value || generateId();
        const title = document.getElementById("modal-expense-title").value;
        const amount = Number(document.getElementById("modal-expense-amount").value);
        const type = document.getElementById("modal-expense-type").value;
        const category = document.getElementById("modal-expense-category").value;
        const date = document.getElementById("modal-expense-date").value;

        saveExpenseFirebase({ id, title, amount, type, category, date });
        closeModal("modal-expense");
        showToast("Expense saved", "success");
    });

    document.getElementById("dca-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-dca-id").value || generateId();
        const title = document.getElementById("modal-dca-title").value;
        const amount = Number(document.getElementById("modal-dca-amount").value);
        const category = document.getElementById("modal-dca-category").value;
        const type = document.getElementById("modal-dca-type").value;
        const date = document.getElementById("modal-dca-date").value;

        saveDcaFirebase({ id, title, amount, category, type, date });
        closeModal("modal-dca");
        showToast("DCA saved", "success");
    });

    document.getElementById("installment-modal-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("modal-installment-id").value || generateId();
        const title = document.getElementById("modal-installment-title").value;
        const creditor = document.getElementById("modal-installment-creditor").value;
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

        saveInstallmentFirebase({ id, title, creditor, totalAmount, interestRate, monthlyAmount, totalMonths, startMonth, category });
        closeModal("modal-installment");
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
                baseSalary: 0, incomes: [], expenses: [], installments: [], dcaList: [], creditCards: [],
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
