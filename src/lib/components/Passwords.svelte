<script>
    import {
        passwordsStore,
        isPasswordsUnlocked,
        passwordsList,
        passwordCategories,
        rememberSession,
    } from "../stores/passwords.js";
    import { currentView } from "../stores/tasks.js";
    import { showConfirm, showAlert, showToast } from "../stores/modal.js";
    import { generatePassword } from "../utils/crypto.js";
    import { exportToCSV, exportToEncryptedJSON } from "../utils/export.js";
    import { onMount, onDestroy, tick } from "svelte";
    import CryptoJS from "crypto-js";

    let masterPassword = "";
    let confirmPassword = "";
    let unlockPassword = "";
    let showSetupModal = false;
    let showUnlockModal = false;
    let showAddModal = false;
    let showEditModal = false;
    let showExportModal = false;
    let searchQuery = "";
    let selectedCategory = "全部";
    let showPasswordValue = {};
    let editingPassword = null;
    let showSidebar = false;
    let showExportMenu = false;
    let isMobile = false;
    let selectedPasswordIds = new Set();
    let selectMode = false;
    let fileInput;
    let importFileInput;
    let importPasswordInput = "";
    let importAttempts = 0;
    let importData = null;
    let isImporting = false;
    let showImportPasswordModal = false;
    let importProgress = 0;
    let importTotal = 0;
    let showImportProgress = false;
    let displayCount = 50;
    let loadingMore = false;
    let loadTrigger;
    let observer;
    let decryptedCache = {};
    let clickOutsideHandler;
    let showChangeMasterPasswordModal = false;
let oldMasterPassword = "";
let newMasterPassword = "";
let confirmNewMasterPassword = "";

    let newPassword = {
        title: "",
        username: "",
        password: "",
        url: "",
        category: "默认",
        notes: "",
    };

    let passwordGenOptions = {
        length: 16,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true,
    };

    onMount(() => {
        isMobile = window.innerWidth < 768;
        const resizeHandler = () => {
            isMobile = window.innerWidth < 768;
        };
        window.addEventListener("resize", resizeHandler);

        passwordsStore.load();

        if (!passwordsStore.hasMasterPassword()) {
            showSetupModal = true;
        } else if (!$isPasswordsUnlocked) {
            if ($rememberSession && passwordsStore.isSessionValid()) {
                passwordsStore.restoreSession();
            } else {
                showUnlockModal = true;
            }
        }

        return () => {
            window.removeEventListener("resize", resizeHandler);
        };
    });

    onDestroy(() => {
        if (observer) {
            observer.disconnect();
        }
        if (clickOutsideHandler) {
            document.removeEventListener("click", clickOutsideHandler);
        }
    });

    function setupIntersectionObserver() {
        if (observer) {
            observer.disconnect();
        }
        if (!loadTrigger) return;

        observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !loadingMore) {
                    loadMore();
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(loadTrigger);
    }

    async function loadMore() {
        if (loadingMore || displayCount >= filteredPasswords.length) return;
        loadingMore = true;
        await tick();
        await new Promise((resolve) => setTimeout(resolve, 50));
        displayCount = Math.min(displayCount + 50, filteredPasswords.length);
        loadingMore = false;
    }

    $: if (loadTrigger && $isPasswordsUnlocked) {
        setupIntersectionObserver();
    }

    $: if (searchQuery || selectedCategory) {
        displayCount = 50;
        decryptedCache = {};
        showPasswordValue = {};
    }

    function getDecryptedPassword(id, encryptedPassword) {
        if (decryptedCache[id]) {
            return decryptedCache[id];
        }
        const decrypted = passwordsStore.decryptPassword(encryptedPassword);
        if (decrypted) {
            decryptedCache[id] = decrypted;
        }
        return decrypted;
    }

    function setupMasterPassword() {
        if (masterPassword.length < 8) {
            showAlert({
                title: "密码太短",
                message: "主密码至少需要8个字符",
                variant: "warning",
            });
            return;
        }
        if (masterPassword !== confirmPassword) {
            showAlert({
                title: "密码不匹配",
                message: "两次输入的密码不一致",
                variant: "warning",
            });
            return;
        }
        passwordsStore.setMasterPassword(masterPassword);
        showSetupModal = false;
        masterPassword = "";
        confirmPassword = "";
    }

    function unlockVault() {
        if (passwordsStore.unlock(unlockPassword)) {
            showUnlockModal = false;
            unlockPassword = "";
            decryptedCache = {};
        } else {
            showAlert({
                title: "密码错误",
                message: "主密码不正确",
                variant: "danger",
            });
        }
    }

    async function handleForgotPassword() {
        const confirmed = await showConfirm({
            title: "忘记密码",
            message:
                "忘记密码将清除所有密码数据，此操作无法恢复！\n\n确定要清除所有数据吗？",
            confirmText: "清除数据",
            cancelText: "返回",
            variant: "danger",
        });
        if (confirmed) {
            passwordsStore.clearAll();
            showUnlockModal = false;
            showSetupModal = true;
            decryptedCache = {};
            showToast({ message: "所有数据已清空", type: "info" });
        } else {
            showUnlockModal = false;
            currentView.set("dashboard");
        }
    }

    function lockVault() {
        closeExportMenu();
        passwordsStore.lock();
        if (!$rememberSession) {
            showUnlockModal = true;
        }
        selectedPasswordIds.clear();
        selectMode = false;
        decryptedCache = {};
        showPasswordValue = {};
    }

    function openAddModal() {
        closeExportMenu();
        newPassword = {
            title: "",
            username: "",
            password: "",
            url: "",
            category: "默认",
            notes: "",
        };
        showAddModal = true;
    }

    function addPassword() {
        if (!newPassword.title || !newPassword.password) {
            showAlert({
                title: "信息不完整",
                message: "标题和密码不能为空",
                variant: "warning",
            });
            return;
        }
        passwordsStore.addPassword(newPassword);
        showAddModal = false;
        showToast({ message: "密码已添加", type: "success" });
    }

    function openEditModal(password) {
        closeExportMenu();
        editingPassword = { ...password };
        editingPassword.password =
            getDecryptedPassword(password.id, password.password) || "";
        showEditModal = true;
    }

    function updatePassword() {
        if (!editingPassword.title || !editingPassword.password) {
            showAlert({
                title: "信息不完整",
                message: "标题和密码不能为空",
                variant: "warning",
            });
            return;
        }
        passwordsStore.updatePassword(editingPassword.id, editingPassword);
        delete decryptedCache[editingPassword.id];
        showEditModal = false;
        editingPassword = null;
        showToast({ message: "密码已更新", type: "success" });
    }

    async function deletePassword(id) {
        const confirmed = await showConfirm({
            title: "删除密码",
            message: "确定要删除这条密码记录吗？",
            confirmText: "删除",
            cancelText: "取消",
            variant: "danger",
        });
        if (confirmed) {
            passwordsStore.deletePassword(id);
            selectedPasswordIds.delete(id);
            selectedPasswordIds = selectedPasswordIds;
            delete decryptedCache[id];
            delete showPasswordValue[id];
            showToast({ message: "密码已删除", type: "success" });
        }
    }

    function generateNewPassword(target = "new") {
        const generated = generatePassword(
            passwordGenOptions.length,
            passwordGenOptions,
        );
        if (target === "new") {
            newPassword.password = generated;
        } else if (target === "edit") {
            editingPassword.password = generated;
        }
    }

    function togglePasswordVisibility(id, encryptedPassword) {
        if (!showPasswordValue[id]) {
            getDecryptedPassword(id, encryptedPassword);
        }
        showPasswordValue[id] = !showPasswordValue[id];
        showPasswordValue = showPasswordValue;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            showToast({ message: "已复制到剪贴板", type: "success" });
        }
    }

    function copyPassword(id, encryptedPassword) {
        const decrypted = getDecryptedPassword(id, encryptedPassword);
        if (decrypted) {
            copyToClipboard(decrypted);
        }
    }

    function toggleSelectMode() {
        closeExportMenu();
        selectMode = !selectMode;
        if (!selectMode) {
            selectedPasswordIds.clear();
            selectedPasswordIds = selectedPasswordIds;
        }
    }

    function togglePasswordSelection(id) {
        if (selectedPasswordIds.has(id)) {
            selectedPasswordIds.delete(id);
        } else {
            selectedPasswordIds.add(id);
        }
        selectedPasswordIds = selectedPasswordIds;
    }

    function selectAllPasswords() {
        filteredPasswords.forEach((p) => selectedPasswordIds.add(p.id));
        selectedPasswordIds = selectedPasswordIds;
    }

    function deselectAllPasswords() {
        selectedPasswordIds.clear();
        selectedPasswordIds = selectedPasswordIds;
    }

    function openExportModal() {
        if (selectMode && selectedPasswordIds.size === 0) {
            showAlert({
                title: "未选择密码",
                message: "请至少选择一条密码记录",
                variant: "warning",
            });
            return;
        }
        closeExportMenu();
        showExportModal = true;
    }

    function triggerImport() {
        closeExportMenu();
        importFileInput?.click();
    }

    function closeExportMenu() {
        showExportMenu = false;
    }

    function openChangeMasterPasswordModal() {
    closeExportMenu();
    oldMasterPassword = "";
    newMasterPassword = "";
    confirmNewMasterPassword = "";
    showChangeMasterPasswordModal = true;
}

async function handleChangeMasterPassword() {
    if (!oldMasterPassword) {
        showAlert({
            title: "请输入原密码",
            message: "请输入当前的主密码",
            variant: "warning",
        });
        return;
    }

    if (newMasterPassword.length < 8) {
        showAlert({
            title: "密码太短",
            message: "新密码至少需要8个字符",
            variant: "warning",
        });
        return;
    }

    if (newMasterPassword !== confirmNewMasterPassword) {
        showAlert({
            title: "密码不匹配",
            message: "两次输入的新密码不一致",
            variant: "warning",
        });
        return;
    }

    const result = passwordsStore.changeMasterPassword(oldMasterPassword, newMasterPassword);
    
    if (result.success) {
        showChangeMasterPasswordModal = false;
        oldMasterPassword = "";
        newMasterPassword = "";
        confirmNewMasterPassword = "";
        decryptedCache = {};
        showPasswordValue = {};
        showToast({ message: "主密码修改成功", type: "success" });
    } else {
        showAlert({
            title: "修改失败",
            message: result.error,
            variant: "danger",
        });
    }
}

    function toggleExportMenu(event) {
        event?.stopPropagation();
        showExportMenu = !showExportMenu;
    }

    async function handleExport(format, useEncryption = false) {
        showExportModal = false;
        const idsToExport =
            selectMode && selectedPasswordIds.size > 0
                ? Array.from(selectedPasswordIds)
                : null;
        const decrypted = passwordsStore.getDecryptedPasswords(idsToExport);
        if (decrypted.length === 0) {
            showToast({ message: "没有可导出的数据", type: "warning" });
            return;
        }
        const masterPass = useEncryption
            ? passwordsStore.getMasterPassword()
            : "";
        const timestamp = new Date().toISOString().split("T")[0];
        try {
            if (format === "csv") {
                const data = decrypted.map((p) => ({
                    标题: p.title,
                    用户名: p.username,
                    密码: p.password,
                    网址: p.url,
                    分类: p.category,
                    备注: p.notes,
                    创建时间: p.createdAt,
                    更新时间: p.updatedAt,
                }));
                const result = exportToCSV(data, `passwords_${timestamp}.csv`, {
                    showToast,
                });
                if (!result.success) throw new Error(result.error);
            } else if (format === "json") {
                const result = exportToEncryptedJSON(
                    decrypted,
                    `passwords_${timestamp}.json`,
                    masterPass,
                    { showToast },
                );
                if (!result.success) throw new Error(result.error);
            }
            if (selectMode) {
                selectedPasswordIds.clear();
                selectedPasswordIds = selectedPasswordIds;
                selectMode = false;
            }
        } catch (e) {
            showToast({ message: "导出失败: " + e.message, type: "error" });
        }
    }

    async function handleImportFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        isImporting = true;
        const fileName = file.name.toLowerCase();
        try {
            if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
                await importFromExcel(file);
            } else if (fileName.endsWith(".csv")) {
                await importFromCSV(file);
            } else if (fileName.endsWith(".json")) {
                await importFromJSON(file);
            } else {
                showToast({
                    message: "不支持的文件格式，支持 Excel、CSV、JSON",
                    type: "error",
                });
            }
        } catch (e) {
            showToast({ message: "导入失败: " + e.message, type: "error" });
        } finally {
            isImporting = false;
            if (importFileInput) importFileInput.value = "";
        }
    }

    async function importFromExcel(file) {
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            showToast({ message: "Excel 文件为空", type: "error" });
            return;
        }

        const jsonData = [];
        const headers = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) {
                row.eachCell((cell, colNumber) => {
                    headers[colNumber - 1] = String(cell.value || "");
                });
            } else {
                const rowData = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber - 1];
                    if (header) {
                        rowData[header] =
                            cell.value !== null && cell.value !== undefined
                                ? String(cell.value)
                                : "";
                    }
                });
                if (Object.keys(rowData).length > 0) {
                    jsonData.push(rowData);
                }
            }
        });

        await processImportedDataAsync(jsonData);
    }

    async function importFromCSV(file) {
        const text = await file.text();
        const lines = text.split("\n").filter((line) => line.trim());
        if (lines.length < 2) {
            showToast({ message: "CSV 文件为空", type: "error" });
            return;
        }
        const headers = parseCSVLine(lines[0]);
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || "";
            });
            data.push(row);
        }
        await processImportedDataAsync(data);
    }

    function parseCSVLine(line) {
        const result = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === "," && !inQuotes) {
                result.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    async function importFromJSON(file) {
        const text = await file.text();
        try {
            const json = JSON.parse(text);
            if (json.encrypted) {
                importData = json;
                importAttempts = 0;
                importPasswordInput = "";
                showImportPasswordModal = true;
            } else if (Array.isArray(json)) {
                await processImportedDataAsync(json);
            } else {
                showToast({ message: "JSON 格式不正确", type: "error" });
            }
        } catch (e) {
            showToast({
                message: "JSON 解析失败: " + e.message,
                type: "error",
            });
        }
    }

    function verifyImportPassword() {
        if (!importPasswordInput || !importData) return;
        try {
            const decrypted = CryptoJS.AES.decrypt(
                importData.data,
                importPasswordInput,
            ).toString(CryptoJS.enc.Utf8);
            if (!decrypted) {
                throw new Error("解密失败");
            }
            const data = JSON.parse(decrypted);
            showImportPasswordModal = false;
            importData = null;
            importPasswordInput = "";
            importAttempts = 0;
            processImportedDataAsync(data);
        } catch (e) {
            importAttempts++;
            if (importAttempts >= 3) {
                showToast({
                    message: "密码错误次数过多，请重新选择文件",
                    type: "error",
                });
                showImportPasswordModal = false;
                importData = null;
                importAttempts = 0;
            } else {
                showToast({
                    message: `密码错误，还剩 ${3 - importAttempts} 次机会`,
                    type: "error",
                });
            }
            importPasswordInput = "";
        }
    }

    function cancelImportPassword() {
        showImportPasswordModal = false;
        importData = null;
        importPasswordInput = "";
        importAttempts = 0;
    }

    async function processImportedDataAsync(data) {
        if (!Array.isArray(data) || data.length === 0) {
            showToast({ message: "没有可导入的数据", type: "warning" });
            return;
        }

        const validEntries = data
            .filter((item) => {
                const title =
                    item.title ||
                    item["标题"] ||
                    item.Title ||
                    item.name ||
                    item.Name ||
                    "";
                const password =
                    item.password || item["密码"] || item.Password || "";
                return title && password;
            })
            .map((item) => ({
                title:
                    item.title ||
                    item["标题"] ||
                    item.Title ||
                    item.name ||
                    item.Name ||
                    "",
                username:
                    item.username ||
                    item["用户名"] ||
                    item.Username ||
                    item.login ||
                    item.Login ||
                    "",
                password: item.password || item["密码"] || item.Password || "",
                url: item.url || item["网址"] || item.URL || item.Url || "",
                category:
                    item.category || item["分类"] || item.Category || "默认",
                notes:
                    item.notes ||
                    item["备注"] ||
                    item.Notes ||
                    item.note ||
                    item.Note ||
                    "",
            }));

        if (validEntries.length === 0) {
            showToast({ message: "没有有效的密码记录可导入", type: "warning" });
            return;
        }

        importTotal = validEntries.length;
        importProgress = 0;
        showImportProgress = true;

        const BATCH_SIZE = 100;
        let imported = 0;

        for (let i = 0; i < validEntries.length; i += BATCH_SIZE) {
            const batch = validEntries.slice(i, i + BATCH_SIZE);
            await new Promise((resolve) => setTimeout(resolve, 0));
            const count = passwordsStore.addPasswordsBatch(batch);
            imported += count;
            importProgress = Math.min(i + BATCH_SIZE, validEntries.length);
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        showImportProgress = false;
        importProgress = 0;
        importTotal = 0;
        decryptedCache = {};

        if (imported > 0) {
            showToast({
                message: `成功导入 ${imported} 条密码记录`,
                type: "success",
            });
        }
    }

    async function clearAllPasswords() {
        closeExportMenu();
        const confirmed = await showConfirm({
            title: "清空所有密码",
            message: "警告：此操作将永久删除所有密码记录和主密码，无法恢复！",
            confirmText: "确认清空",
            cancelText: "取消",
            variant: "danger",
        });
        if (confirmed) {
            passwordsStore.clearAll();
            showSetupModal = true;
            decryptedCache = {};
            showPasswordValue = {};
            showToast({ message: "所有数据已清空", type: "info" });
        }
    }

    function selectCategory(category) {
        selectedCategory = category;
        displayCount = 50;
        decryptedCache = {};
        showPasswordValue = {};
        if (isMobile) showSidebar = false;
    }

    function toggleRememberSession() {
        closeExportMenu();
        passwordsStore.setRememberSession(!$rememberSession);
        showToast({
            message: $rememberSession ? "已开启会话记忆" : "已关闭会话记忆",
            type: "info",
        });
    }

    $: filteredPasswords = $passwordsList.filter((p) => {
        const matchesSearch =
            p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.url.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory =
            selectedCategory === "全部" || p.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    $: displayedPasswords = filteredPasswords.slice(0, displayCount);
    $: hasMore = displayCount < filteredPasswords.length;

    $: if (typeof window !== "undefined") {
        if (showExportMenu) {
            const handler = (e) => {
                const menu = document.querySelector(".export-menu-dropdown");
                const button = document.querySelector(".export-menu-button");
                if (
                    menu &&
                    button &&
                    !menu.contains(e.target) &&
                    !button.contains(e.target)
                ) {
                    closeExportMenu();
                }
            };
            setTimeout(() => {
                document.addEventListener("click", handler);
                clickOutsideHandler = handler;
            }, 0);
        } else if (clickOutsideHandler) {
            document.removeEventListener("click", clickOutsideHandler);
            clickOutsideHandler = null;
        }
    }
</script>

<input
    type="file"
    bind:this={importFileInput}
    on:change={handleImportFile}
    accept=".xlsx,.xls,.csv,.json"
    class="hidden"
/>

<div class="flex flex-col h-screen md:h-full overflow-hidden bg-slate-50">
    <header
        class="h-14 md:h-16 bg-white/90 backdrop-blur px-4 md:px-6 flex justify-between items-center z-10 sticky top-0 border-b border-slate-200 shrink-0"
    >
        <div class="flex items-center gap-2">
            {#if isMobile && $isPasswordsUnlocked}
                <button
                    on:click={() => (showSidebar = !showSidebar)}
                    class="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                    <i class="ph ph-funnel text-xl"></i>
                </button>
            {/if}
            <div>
                <h2 class="text-base md:text-lg font-bold text-amber-800">
                    密码记录本
                </h2>
                <div class="text-[10px] md:text-xs text-slate-500">
                    {#if $isPasswordsUnlocked}
                        共 {filteredPasswords.length} 条
                    {:else}
                        加密存储
                    {/if}
                </div>
            </div>
        </div>
        {#if $isPasswordsUnlocked}
            <div class="flex items-center gap-1 md:gap-2">
                {#if selectMode}
                    <button
                        on:click={selectAllPasswords}
                        class="h-9 px-3 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-xs font-bold"
                    >
                        全选
                    </button>
                    <button
                        on:click={deselectAllPasswords}
                        class="h-9 px-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold"
                    >
                        取消
                    </button>
                    <span class="text-xs text-slate-500"
                        >已选 {selectedPasswordIds.size}</span
                    >
                {:else}
                    <button
                        on:click={openAddModal}
                        class="h-9 px-3 md:px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-bold shadow-md flex items-center gap-1 md:gap-2"
                    >
                        <i class="ph-bold ph-plus"></i>
                        <span class="hidden md:inline">新建</span>
                    </button>
                {/if}
                <div class="relative">
                    <button
                        on:click={toggleExportMenu}
                        class="export-menu-button h-9 px-3 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600"
                    >
                        <i class="ph ph-dots-three-vertical"></i>
                    </button>
                    {#if showExportMenu}
                        <div
                            class="export-menu-dropdown absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 min-w-[150px]"
                        >
                            <button
                                on:click={toggleSelectMode}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i
                                    class="ph ph-check-square text-lg text-blue-600"
                                ></i>
                                {selectMode ? "退出选择" : "选择导出"}
                            </button>
                            <button
                                on:click={openExportModal}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph ph-export text-lg text-green-600"
                                ></i> 导出密码
                            </button>
                            <button
                                on:click={triggerImport}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i
                                    class="ph ph-download text-lg text-purple-600"
                                ></i> 导入密码
                            </button>
                            <button
    on:click={openChangeMasterPasswordModal}
    class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
>
    <i class="ph ph-password text-lg text-blue-600"></i>
    修改主密码
</button>
                            <hr class="my-1 border-slate-100" />
                            <button
                                on:click={toggleRememberSession}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i
                                    class="ph {$rememberSession
                                        ? 'ph-check-square'
                                        : 'ph-square'} text-lg text-indigo-600"
                                ></i>
                                记住会话
                            </button>
                            <button
                                on:click={lockVault}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph ph-lock text-lg text-slate-500"
                                ></i> 锁定
                            </button>
                            <button
                                on:click={clearAllPasswords}
                                class="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                            >
                                <i class="ph ph-trash text-lg"></i> 清空所有
                            </button>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
    </header>

    {#if showImportProgress}
        <div class="bg-purple-50 border-b border-purple-200 px-4 py-3">
            <div class="flex items-center justify-between mb-2">
                <span class="text-sm text-purple-700 font-bold"
                    >正在导入密码...</span
                >
                <span class="text-xs text-purple-600"
                    >{importProgress} / {importTotal}</span
                >
            </div>
            <div class="w-full bg-purple-200 rounded-full h-2">
                <div
                    class="bg-purple-600 h-2 rounded-full transition-all duration-100"
                    style="width: {(importProgress / importTotal) * 100}%"
                ></div>
            </div>
        </div>
    {/if}

    {#if $isPasswordsUnlocked}
        <div class="flex flex-1 overflow-hidden relative">
            {#if isMobile && showSidebar}
                <div
                    class="absolute inset-0 bg-black/30 z-20"
                    on:click={() => (showSidebar = false)}
                    on:keydown={() => (showSidebar = false)}
                    role="button"
                    tabindex="0"
                ></div>
            {/if}

            <div
                class="w-48 md:w-56 bg-white border-r border-slate-200 flex flex-col shrink-0 absolute md:relative z-30 h-full transition-transform duration-200"
                class:translate-x-0={!isMobile || showSidebar}
                class:-translate-x-full={isMobile && !showSidebar}
            >
                <div class="p-3 border-b border-slate-100">
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="搜索..."
                        class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div class="flex-1 overflow-y-auto py-2">
                    <button
                        on:click={() => selectCategory("全部")}
                        class="w-full text-left px-4 py-2.5 text-sm transition"
                        class:bg-amber-50={selectedCategory === "全部"}
                        class:text-amber-700={selectedCategory === "全部"}
                        class:font-bold={selectedCategory === "全部"}
                        class:text-slate-600={selectedCategory !== "全部"}
                        class:hover:bg-slate-50={selectedCategory !== "全部"}
                    >
                        <i class="ph ph-folder-open mr-2"></i> 全部
                    </button>
                    {#each $passwordCategories as category}
                        <button
                            on:click={() => selectCategory(category)}
                            class="w-full text-left px-4 py-2.5 text-sm transition"
                            class:bg-amber-50={selectedCategory === category}
                            class:text-amber-700={selectedCategory === category}
                            class:font-bold={selectedCategory === category}
                            class:text-slate-600={selectedCategory !== category}
                            class:hover:bg-slate-50={selectedCategory !==
                                category}
                        >
                            <i class="ph ph-folder mr-2"></i>
                            {category}
                        </button>
                    {/each}
                </div>
            </div>

            <div
                class="flex-1 overflow-y-auto p-4 overscroll-contain"
                style="-webkit-overflow-scrolling: touch;"
            >
                {#if filteredPasswords.length === 0}
                    <div
                        class="flex items-center justify-center h-64 text-slate-400"
                    >
                        <div class="text-center">
                            <i class="ph ph-key text-5xl mb-4"></i>
                            <p class="text-lg font-bold">暂无密码记录</p>
                            {#if isMobile}
                                <button
                                    on:click={() => (showSidebar = true)}
                                    class="mt-4 text-amber-600 font-bold text-sm"
                                >
                                    <i class="ph ph-funnel"></i> 筛选分类
                                </button>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <div class="password-grid pb-4">
                        {#each displayedPasswords as password, index (password.id)}
                            <div
                                class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition flex flex-col password-card"
                                class:ring-2={selectMode &&
                                    selectedPasswordIds.has(password.id)}
                                class:ring-amber-400={selectMode &&
                                    selectedPasswordIds.has(password.id)}
                                style="animation-delay: {Math.min(
                                    index % 50,
                                    10,
                                ) * 30}ms"
                            >
                                <div
                                    class="flex items-start justify-between mb-3"
                                >
                                    <div
                                        class="flex-1 min-w-0 flex items-center gap-2"
                                    >
                                        {#if selectMode}
                                            <button
                                                on:click={() =>
                                                    togglePasswordSelection(
                                                        password.id,
                                                    )}
                                                class="shrink-0"
                                            >
                                                <i
                                                    class="ph {selectedPasswordIds.has(
                                                        password.id,
                                                    )
                                                        ? 'ph-check-square'
                                                        : 'ph-square'} text-2xl text-amber-600"
                                                ></i>
                                            </button>
                                        {/if}
                                        <div class="flex-1 min-w-0">
                                            <h3
                                                class="font-bold text-slate-800 text-base mb-1 truncate"
                                            >
                                                {password.title}
                                            </h3>
                                            <span
                                                class="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded"
                                                >{password.category}</span
                                            >
                                        </div>
                                    </div>
                                    {#if !selectMode}
                                        <div class="flex gap-1 shrink-0 ml-2">
                                            <button
                                                on:click={() =>
                                                    openEditModal(password)}
                                                class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                            >
                                                <i class="ph ph-pencil-simple"
                                                ></i>
                                            </button>
                                            <button
                                                on:click={() =>
                                                    deletePassword(password.id)}
                                                class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                            >
                                                <i class="ph ph-trash"></i>
                                            </button>
                                        </div>
                                    {/if}
                                </div>

                                <div class="space-y-2 text-sm flex-1">
                                    <div class="flex items-center gap-2 h-7">
                                        <i
                                            class="ph ph-user text-slate-400 shrink-0"
                                        ></i>
                                        <span
                                            class="text-slate-600 truncate flex-1 {!password.username
                                                ? 'text-slate-400 italic'
                                                : ''}"
                                        >
                                            {password.username || "未设置"}
                                        </span>
                                        {#if password.username}
                                            <button
                                                on:click={() =>
                                                    copyToClipboard(
                                                        password.username,
                                                    )}
                                                class="text-slate-400 hover:text-blue-600 shrink-0 p-1"
                                            >
                                                <i class="ph ph-copy"></i>
                                            </button>
                                        {/if}
                                    </div>

                                    <div class="flex items-center gap-2 h-7">
                                        <i
                                            class="ph ph-lock text-slate-400 shrink-0"
                                        ></i>
                                        <input
                                            type={showPasswordValue[password.id]
                                                ? "text"
                                                : "password"}
                                            value={showPasswordValue[
                                                password.id
                                            ]
                                                ? decryptedCache[password.id] ||
                                                  "••••••••"
                                                : "••••••••"}
                                            readonly
                                            class="flex-1 bg-slate-50 px-2 py-1 rounded text-slate-600 font-mono text-xs min-w-0"
                                        />
                                        <button
                                            on:click={() =>
                                                togglePasswordVisibility(
                                                    password.id,
                                                    password.password,
                                                )}
                                            class="text-slate-400 hover:text-blue-600 shrink-0 p-1"
                                        >
                                            <i
                                                class="ph ph-eye{showPasswordValue[
                                                    password.id
                                                ]
                                                    ? '-slash'
                                                    : ''}"
                                            ></i>
                                        </button>
                                        <button
                                            on:click={() =>
                                                copyPassword(
                                                    password.id,
                                                    password.password,
                                                )}
                                            class="text-slate-400 hover:text-blue-600 shrink-0 p-1"
                                        >
                                            <i class="ph ph-copy"></i>
                                        </button>
                                    </div>

                                    {#if password.url}
                                        <div
                                            class="flex items-center gap-2 h-7"
                                        >
                                            <i
                                                class="ph ph-link text-slate-400 shrink-0"
                                            ></i>
                                            <a
                                                href={password.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="text-blue-600 hover:underline truncate flex-1 text-xs"
                                            >
                                                {password.url}
                                            </a>
                                        </div>
                                    {/if}

                                    {#if password.notes}
                                        <div class="flex items-start gap-2">
                                            <i
                                                class="ph ph-note text-slate-400 mt-0.5 shrink-0"
                                            ></i>
                                            <span
                                                class="text-slate-500 text-xs line-clamp-2"
                                                >{password.notes}</span
                                            >
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>

                    {#if hasMore}
                        <div
                            bind:this={loadTrigger}
                            class="flex justify-center py-8 pb-20"
                        >
                            {#if loadingMore}
                                <div
                                    class="flex items-center gap-2 text-slate-400"
                                >
                                    <i
                                        class="ph ph-spinner animate-spin text-xl"
                                    ></i>
                                    <span class="text-sm">加载中...</span>
                                </div>
                            {:else}
                                <div class="text-sm text-slate-400">
                                    向下滚动加载更多
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div class="pb-20"></div>
                    {/if}
                {/if}
            </div>
        </div>
    {/if}
</div>

{#if showImportPasswordModal}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3
                class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2"
            >
                <i class="ph-fill ph-lock text-purple-600"></i> 输入导入密码
            </h3>
            <p class="text-sm text-slate-600 mb-4">
                检测到加密的 JSON 文件，请输入密码解密：
            </p>
            <input
                type="password"
                bind:value={importPasswordInput}
                on:keydown={(e) => e.key === "Enter" && verifyImportPassword()}
                placeholder="输入导出时设置的密码"
                class="w-full border border-slate-200 rounded-lg px-3 py-2.5 mb-3 focus:outline-none focus:border-purple-400"
            />
            <p class="text-xs text-slate-500 mb-4">
                剩余尝试次数：{3 - importAttempts}
            </p>
            <div class="flex gap-3">
                <button
                    on:click={cancelImportPassword}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    取消
                </button>
                <button
                    on:click={verifyImportPassword}
                    class="flex-1 py-2.5 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700"
                >
                    解密导入
                </button>
            </div>
        </div>
    </div>
{/if}

{#if showExportModal}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3
                class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2"
            >
                <i class="ph-fill ph-export text-amber-600"></i> 导出密码
            </h3>
            <p class="text-sm text-slate-600 mb-4">
                {selectMode && selectedPasswordIds.size > 0
                    ? `将导出 ${selectedPasswordIds.size} 条选中的密码记录`
                    : `将导出全部 ${$passwordsList.length} 条密码记录`}
            </p>
            <div class="space-y-3 mb-6">
                <button
                    on:click={() => handleExport("csv", false)}
                    class="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition"
                >
                    <i class="ph ph-file-csv text-2xl text-green-600"></i>
                    <div class="flex-1 text-left">
                        <div class="font-bold text-slate-700">CSV 格式</div>
                        <div class="text-xs text-slate-500">
                            Excel兼容，明文存储
                        </div>
                    </div>
                </button>
                <button
                    on:click={() => handleExport("json", true)}
                    class="w-full flex items-center gap-3 p-4 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition"
                >
                    <i class="ph ph-lock text-2xl text-amber-600"></i>
                    <div class="flex-1 text-left">
                        <div class="font-bold text-slate-700">加密JSON</div>
                        <div class="text-xs text-slate-500">使用主密码加密</div>
                    </div>
                </button>
            </div>
            <button
                on:click={() => (showExportModal = false)}
                class="w-full py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
            >
                取消
            </button>
        </div>
    </div>
{/if}

{#if showSetupModal}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3
                class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2"
            >
                <i class="ph-fill ph-lock-key text-amber-600"></i> 设置主密码
            </h3>
            <p class="text-sm text-slate-600 mb-4">
                主密码用于加密所有密码记录，请妥善保管，丢失后无法恢复！
            </p>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >主密码（至少8位）</label
                    >
                    <input
                        type="password"
                        bind:value={masterPassword}
                        placeholder="输入主密码"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >确认密码</label
                    >
                    <input
                        type="password"
                        bind:value={confirmPassword}
                        placeholder="再次输入主密码"
                        on:keydown={(e) =>
                            e.key === "Enter" && setupMasterPassword()}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                </div>
            </div>
            <button
                on:click={setupMasterPassword}
                class="w-full mt-4 py-3 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
            >
                创建主密码
            </button>
        </div>
    </div>
{/if}

{#if showUnlockModal}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3
                class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2"
            >
                <i class="ph-fill ph-lock text-amber-600"></i> 解锁密码库
            </h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >主密码</label
                    >
                    <input
                        type="password"
                        bind:value={unlockPassword}
                        on:keydown={(e) => e.key === "Enter" && unlockVault()}
                        placeholder="输入主密码"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                </div>
            </div>
            <button
                on:click={unlockVault}
                class="w-full mt-4 py-3 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
            >
                解锁
            </button>
            <button
                on:click={handleForgotPassword}
                class="w-full mt-3 py-2 text-slate-500 hover:text-red-600 text-sm font-bold"
            >
                忘记密码？
            </button>
        </div>
    </div>
{/if}

{#if showAddModal}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div
            class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        >
            <h3 class="text-xl font-bold text-slate-800 mb-4">新建密码</h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >标题 *</label
                    >
                    <input
                        type="text"
                        bind:value={newPassword.title}
                        placeholder="例如：Google 账号"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >用户名/邮箱</label
                    >
                    <input
                        type="text"
                        bind:value={newPassword.username}
                        placeholder="username@example.com"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block flex justify-between items-center"
                    >
                        <span>密码 *</span>
                        <button
                            on:click={() => generateNewPassword("new")}
                            class="text-blue-600 text-xs font-bold"
                        >
                            <i class="ph ph-magic-wand"></i> 生成
                        </button>
                    </label>
                    <input
                        type="text"
                        bind:value={newPassword.password}
                        placeholder="密码"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 font-mono"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >网址</label
                    >
                    <input
                        type="url"
                        bind:value={newPassword.url}
                        placeholder="https://example.com"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >分类</label
                    >
                    <select
                        bind:value={newPassword.category}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    >
                        {#each $passwordCategories as cat}
                            <option value={cat}>{cat}</option>
                        {/each}
                    </select>
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >备注</label
                    >
                    <textarea
                        bind:value={newPassword.notes}
                        rows="3"
                        placeholder="其他信息..."
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                    ></textarea>
                </div>
            </div>
            <div class="flex gap-3 mt-4">
                <button
                    on:click={() => (showAddModal = false)}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    取消
                </button>
                <button
                    on:click={addPassword}
                    class="flex-1 py-2.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
                >
                    保存
                </button>
            </div>
        </div>
    </div>
{/if}

{#if showEditModal && editingPassword}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div
            class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        >
            <h3 class="text-xl font-bold text-slate-800 mb-4">编辑密码</h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >标题 *</label
                    >
                    <input
                        type="text"
                        bind:value={editingPassword.title}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >用户名/邮箱</label
                    >
                    <input
                        type="text"
                        bind:value={editingPassword.username}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block flex justify-between items-center"
                    >
                        <span>密码 *</span>
                        <button
                            on:click={() => generateNewPassword("edit")}
                            class="text-blue-600 text-xs font-bold"
                        >
                            <i class="ph ph-magic-wand"></i> 生成
                        </button>
                    </label>
                    <input
                        type="text"
                        bind:value={editingPassword.password}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 font-mono"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >网址</label
                    >
                    <input
                        type="url"
                        bind:value={editingPassword.url}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >分类</label
                    >
                    <select
                        bind:value={editingPassword.category}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    >
                        {#each $passwordCategories as cat}
                            <option value={cat}>{cat}</option>
                        {/each}
                    </select>
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >备注</label
                    >
                    <textarea
                        bind:value={editingPassword.notes}
                        rows="3"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                    ></textarea>
                </div>
            </div>
            <div class="flex gap-3 mt-4">
                <button
                    on:click={() => {
                        showEditModal = false;
                        editingPassword = null;
                    }}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    取消
                </button>
                <button
                    on:click={updatePassword}
                    class="flex-1 py-2.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
                >
                    保存
                </button>
            </div>
        </div>
    </div>
{/if}

{#if showChangeMasterPasswordModal}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3
                class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2"
            >
                <i class="ph-fill ph-password text-blue-600"></i> 修改主密码
            </h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >原密码</label
                    >
                    <input
                        type="password"
                        bind:value={oldMasterPassword}
                        placeholder="输入当前主密码"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >新密码（至少8位）</label
                    >
                    <input
                        type="password"
                        bind:value={newMasterPassword}
                        placeholder="输入新密码"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >确认新密码</label
                    >
                    <input
                        type="password"
                        bind:value={confirmNewMasterPassword}
                        on:keydown={(e) =>
                            e.key === "Enter" && handleChangeMasterPassword()}
                        placeholder="再次输入新密码"
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400"
                    />
                </div>
            </div>
            <div class="flex gap-3 mt-4">
                <button
                    on:click={() => (showChangeMasterPasswordModal = false)}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    取消
                </button>
                <button
                    on:click={handleChangeMasterPassword}
                    class="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                >
                    确认修改
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .password-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1rem;
        align-items: start;
    }

    @media (min-width: 640px) {
        .password-grid {
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        }
    }

    @media (min-width: 1280px) {
        .password-grid {
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        }
    }

    .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .password-card {
        animation: fadeIn 0.3s ease-out forwards;
        opacity: 0;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
</style>
