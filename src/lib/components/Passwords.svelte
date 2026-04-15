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
    import { _ } from 'svelte-i18n';
    import { get as getI18n } from 'svelte/store';

    let masterPassword = "";
    let confirmPassword = "";
    let unlockPassword = "";
    let showSetupModal = false;
    let showUnlockModal = false;
    let showAddModal = false;
    let showEditModal = false;
    let showExportModal = false;
    let searchQuery = "";
    let selectedCategory = "__ALL__";
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
        category: getI18n(_)('passwords.categories.default') || 'Default',        notes: "",
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
        const t = getI18n(_);
        if (masterPassword.length < 8) {
            showAlert({
                title: t('common.warning'),
                message: t('passwords.master_too_short'),
                variant: "warning",
            });
            return;
        }
        if (masterPassword !== confirmPassword) {
            showAlert({
                title: t('common.warning'),
                message: t('passwords.master_mismatch'),
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
        const t = getI18n(_);
        if (passwordsStore.unlock(unlockPassword)) {
            showUnlockModal = false;
            unlockPassword = "";
            decryptedCache = {};
        } else {
            showAlert({
                title: t('common.warning'),
                message: t('passwords.master_wrong'),
                variant: "danger",
            });
        }
    }

    async function handleForgotPassword() {
        const t = getI18n(_);
        const confirmed = await showConfirm({
            title: t('passwords.clear_title'),
            message: t('passwords.clear_confirm'),
            confirmText: t('passwords.clear_confirm_btn'),
            cancelText: t('common.cancel'),
            variant: "danger",
        });
        if (confirmed) {
            passwordsStore.clearAll();
            showUnlockModal = false;
            showSetupModal = true;
            decryptedCache = {};
            showToast({ message: t('settings.clear_success'), type: "info" });
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
            category: getI18n(_)('passwords.categories.default') || 'Default',
            notes: "",
        };
        showAddModal = true;
    }

    function addPassword() {
        const t = getI18n(_);
        if (!newPassword.title || !newPassword.password) {
            showAlert({
                title: t('common.warning'),
                message: t('passwords.title_required'),
                variant: "warning",
            });
            return;
        }
        passwordsStore.addPassword(newPassword);
        showAddModal = false;
        showToast({ message: t('passwords.password_added'), type: "success" });
    }

    function openEditModal(password) {
        closeExportMenu();
        editingPassword = { ...password };
        editingPassword.password =
            getDecryptedPassword(password.id, password.password) || "";
        showEditModal = true;
    }

    function updatePassword() {
        const t = getI18n(_);
        if (!editingPassword.title || !editingPassword.password) {
            showAlert({
                title: t('common.warning'),
                message: t('passwords.title_required'),
                variant: "warning",
            });
            return;
        }
        passwordsStore.updatePassword(editingPassword.id, editingPassword);
        delete decryptedCache[editingPassword.id];
        showEditModal = false;
        editingPassword = null;
        showToast({ message: t('passwords.password_updated'), type: "success" });
    }

    async function deletePassword(id) {
        const t = getI18n(_);
        const confirmed = await showConfirm({
            title: t('passwords.delete_password'),
            message: t('passwords.delete_confirm'),
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
            variant: "danger",
        });
        if (confirmed) {
            passwordsStore.deletePassword(id);
            selectedPasswordIds.delete(id);
            selectedPasswordIds = selectedPasswordIds;
            delete decryptedCache[id];
            delete showPasswordValue[id];
            showToast({ message: t('passwords.password_deleted'), type: "success" });
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
            showToast({ message: getI18n(_)('common.copied'), type: "success" });
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
        const t = getI18n(_);
        if (selectMode && selectedPasswordIds.size === 0) {
            showAlert({
                title: t('passwords.no_selected'),
                message: t('passwords.select_first'),
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
    const t = getI18n(_);
    if (!oldMasterPassword) {
        showAlert({
            title: t('passwords.enter_master_title'),
            message: t('passwords.enter_master'),
            variant: "warning",
        });
        return;
    }

    if (newMasterPassword.length < 8) {
        showAlert({
            title: t('passwords.password_too_short_title'),
            message: t('passwords.master_too_short'),
            variant: "warning",
        });
        return;
    }

    if (newMasterPassword !== confirmNewMasterPassword) {
        showAlert({
            title: t('passwords.password_mismatch_title'),
            message: t('passwords.master_mismatch'),
            variant: "warning",
        });
        return;
    }

    const result = await passwordsStore.changeMasterPassword(oldMasterPassword, newMasterPassword);

    if (result.success) {
        showChangeMasterPasswordModal = false;
        oldMasterPassword = "";
        newMasterPassword = "";
        confirmNewMasterPassword = "";
        decryptedCache = {};
        showPasswordValue = {};
        showToast({ message: t('passwords.master_changed'), type: "success" });
    } else {
        showAlert({
            title: t('passwords.change_failed'),
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
        const t = getI18n(_);
        showExportModal = false;
        const idsToExport =
            selectMode && selectedPasswordIds.size > 0
                ? Array.from(selectedPasswordIds)
                : null;
        const decrypted = passwordsStore.getDecryptedPasswords(idsToExport);
        if (decrypted.length === 0) {
            showToast({ message: t('passwords.no_export'), type: "warning" });
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
            showToast({ message: t('passwords.export_failed', { values: { error: e.message } }), type: "error" });
        }
    }

    async function handleImportFile(event) {
        const t = getI18n(_);
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
                    message: t('passwords.unsupported_format'),
                    type: "error",
                });
            }
        } catch (e) {
            showToast({ message: t('passwords.import_failed', { values: { error: e.message } }), type: "error" });
        } finally {
            isImporting = false;
            if (importFileInput) importFileInput.value = "";
        }
    }

    async function importFromExcel(file) {
        const t = getI18n(_);
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            showToast({ message: t('passwords.excel_empty'), type: "error" });
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
        const t = getI18n(_);
        const text = await file.text();
        const lines = text.split("\n").filter((line) => line.trim());
        if (lines.length < 2) {
            showToast({ message: t('passwords.csv_empty'), type: "error" });
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
        const t = getI18n(_);
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
                showToast({ message: t('passwords.json_invalid'), type: "error" });
            }
        } catch (e) {
            showToast({
                message: t('passwords.json_parse_failed', { values: { error: e.message } }),
                type: "error",
            });
        }
    }

    function verifyImportPassword() {
        const t = getI18n(_);
        if (!importPasswordInput || !importData) return;
        try {
            const decrypted = CryptoJS.AES.decrypt(
                importData.data,
                importPasswordInput,
            ).toString(CryptoJS.enc.Utf8);
            if (!decrypted) {
                throw new Error(t('passwords.decrypt_failed'));
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
                    message: t('passwords.too_many_attempts'),
                    type: "error",
                });
                showImportPasswordModal = false;
                importData = null;
                importAttempts = 0;
            } else {
                showToast({
                    message: t('passwords.wrong_password', { values: { remaining: 3 - importAttempts } }),
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
        const t = getI18n(_);
        if (!Array.isArray(data) || data.length === 0) {
            showToast({ message: t('passwords.no_import_data'), type: "warning" });
            return;
        }

        const defaultCategory = t('passwords.categories.default') || 'Default';
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
                    item.category || item["分类"] || item.Category || defaultCategory,
                notes:
                    item.notes ||
                    item["备注"] ||
                    item.Notes ||
                    item.note ||
                    item.Note ||
                    "",
            }));

        if (validEntries.length === 0) {
            showToast({ message: t('passwords.import_empty'), type: "warning" });
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
                message: t('passwords.import_success', { values: { count: imported } }),
                type: "success",
            });
        }
    }

    async function clearAllPasswords() {
        const t = getI18n(_);
        closeExportMenu();
        const confirmed = await showConfirm({
            title: t('passwords.clear_title'),
            message: t('passwords.clear_confirm'),
            confirmText: t('passwords.clear_confirm_btn'),
            cancelText: t('common.cancel'),
            variant: "danger",
        });
        if (confirmed) {
            passwordsStore.clearAll();
            showSetupModal = true;
            decryptedCache = {};
            showPasswordValue = {};
            showToast({ message: t('passwords.all_cleared'), type: "info" });
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
        const t = getI18n(_);
        closeExportMenu();
        passwordsStore.setRememberSession(!$rememberSession);
        showToast({
            message: $rememberSession ? t('passwords.session_on') : t('passwords.session_off'),
            type: "info",
        });
    }

    $: filteredPasswords = $passwordsList.filter((p) => {
        const matchesSearch =
            p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.url.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory =
            selectedCategory === "__ALL__" || p.category === selectedCategory;
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
                    {$_('passwords.title')}
                </h2>
                <div class="text-[10px] md:text-xs text-slate-500">
                    {#if $isPasswordsUnlocked}
                        {$_('passwords.count', { values: { count: filteredPasswords.length } })}
                    {:else}
                        {$_('passwords.subtitle')}
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
                        {$_('common.select_all')}
                    </button>
                    <button
                        on:click={deselectAllPasswords}
                        class="h-9 px-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold"
                    >
                        {$_('common.cancel')}
                    </button>
                    <span class="text-xs text-slate-500"
                        >{selectedPasswordIds.size}</span
                    >
                {:else}
                    <button
                        on:click={openAddModal}
                        class="h-9 px-3 md:px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-bold shadow-md flex items-center gap-1 md:gap-2"
                    >
                        <i class="ph-bold ph-plus"></i>
                        <span class="hidden md:inline">{$_('common.new')}</span>
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
                                {selectMode ? $_('passwords.exit_select') : $_('passwords.select_export')}
                            </button>
                            <button
                                on:click={openExportModal}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph ph-export text-lg text-green-600"></i> {$_('passwords.export_passwords')}
                            </button>
                            <button
                                on:click={triggerImport}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph ph-download text-lg text-purple-600"></i> {$_('passwords.import_passwords')}
                            </button>
                            <button
                                on:click={openChangeMasterPasswordModal}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph ph-password text-lg text-blue-600"></i>
                                {$_('passwords.change_master')}
                            </button>
                            <hr class="my-1 border-slate-100" />
                            <button
                                on:click={toggleRememberSession}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph {$rememberSession ? 'ph-check-square' : 'ph-square'} text-lg text-indigo-600"></i>
                                {$_('passwords.remember_session')}
                            </button>
                            <button
                                on:click={lockVault}
                                class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                <i class="ph ph-lock text-lg text-slate-500"></i> {$_('passwords.lock')}
                            </button>
                            <button
                                on:click={clearAllPasswords}
                                class="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                            >
                                <i class="ph ph-trash text-lg"></i> {$_('passwords.clear_all')}
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
                    >{$_('passwords.importing')}</span
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
                        placeholder={$_('common.search')}
                        class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div class="flex-1 overflow-y-auto py-2">
                    <button
                        on:click={() => selectCategory("__ALL__")}
                        class="w-full text-left px-4 py-2.5 text-sm transition"
                        class:bg-amber-50={selectedCategory === "__ALL__"}
                        class:text-amber-700={selectedCategory === "__ALL__"}
                        class:font-bold={selectedCategory === "__ALL__"}
                        class:text-slate-600={selectedCategory !== "__ALL__"}
                        class:hover:bg-slate-50={selectedCategory !== "__ALL__"}
                    >
                        <i class="ph ph-folder-open mr-2"></i> {$_('common.all')}
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
                            <p class="text-lg font-bold">{$_('passwords.no_records')}</p>
                            {#if isMobile}
                                <button
                                    on:click={() => (showSidebar = true)}
                                    class="mt-4 text-amber-600 font-bold text-sm"
                                >
                                    <i class="ph ph-funnel"></i> {$_('passwords.filter_category')}
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
                                            {password.username || $_('passwords.not_set')}
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
                                    <span class="text-sm">{$_('common.loading')}</span>
                                </div>
                            {:else}
                                <div class="text-sm text-slate-400">
                                    {$_('passwords.scroll_more')}
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
                <i class="ph-fill ph-lock text-purple-600"></i> {$_('passwords.import_password_title')}
            </h3>
            <p class="text-sm text-slate-600 mb-4">
                {$_('passwords.import_password_desc')}
            </p>
            <input
                type="password"
                bind:value={importPasswordInput}
                on:keydown={(e) => e.key === "Enter" && verifyImportPassword()}
                placeholder={$_('passwords.import_password_placeholder')}
                class="w-full border border-slate-200 rounded-lg px-3 py-2.5 mb-3 focus:outline-none focus:border-purple-400"
            />
            <p class="text-xs text-slate-500 mb-4">
                {$_('passwords.remaining_attempts', { values: { remaining: 3 - importAttempts } })}
            </p>
            <div class="flex gap-3">
                <button
                    on:click={cancelImportPassword}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    {$_('common.cancel')}
                </button>
                <button
                    on:click={verifyImportPassword}
                    class="flex-1 py-2.5 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700"
                >
                    {$_('passwords.decrypt_import')}
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
                <i class="ph-fill ph-export text-amber-600"></i> {$_('passwords.export_title')}
            </h3>
            <p class="text-sm text-slate-600 mb-4">
                {selectMode && selectedPasswordIds.size > 0
                    ? $_('passwords.export_selected_count', { values: { count: selectedPasswordIds.size } })
                    : $_('passwords.export_all_count', { values: { count: $passwordsList.length } })}
            </p>
            <div class="space-y-3 mb-6">
                <button
                    on:click={() => handleExport("csv", false)}
                    class="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition"
                >
                    <i class="ph ph-file-csv text-2xl text-green-600"></i>
                    <div class="flex-1 text-left">
                        <div class="font-bold text-slate-700">{$_('passwords.csv_format')}</div>
                        <div class="text-xs text-slate-500">
                            {$_('passwords.csv_desc')}
                        </div>
                    </div>
                </button>
                <button
                    on:click={() => handleExport("json", true)}
                    class="w-full flex items-center gap-3 p-4 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition"
                >
                    <i class="ph ph-lock text-2xl text-amber-600"></i>
                    <div class="flex-1 text-left">
                        <div class="font-bold text-slate-700">{$_('passwords.encrypted_json')}</div>
                        <div class="text-xs text-slate-500">{$_('passwords.encrypted_json_desc')}</div>
                    </div>
                </button>
            </div>
            <button
                on:click={() => (showExportModal = false)}
                class="w-full py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
            >
                {$_('common.cancel')}
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
                <i class="ph-fill ph-lock-key text-amber-600"></i> {$_('passwords.setup_title')}
            </h3>
            <p class="text-sm text-slate-600 mb-4">
                {$_('passwords.setup_desc')}
            </p>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.master_label')}</label
                    >
                    <input
                        type="password"
                        bind:value={masterPassword}
                        placeholder={$_('passwords.master_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.confirm_label')}</label
                    >
                    <input
                        type="password"
                        bind:value={confirmPassword}
                        placeholder={$_('passwords.confirm_placeholder')}
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
                {$_('passwords.create_master')}
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
                <i class="ph-fill ph-lock text-amber-600"></i> {$_('passwords.unlock_title')}
            </h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.label_password')}</label
                    >
                    <input
                        type="password"
                        bind:value={unlockPassword}
                        on:keydown={(e) => e.key === "Enter" && unlockVault()}
                        placeholder={$_('passwords.master_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                </div>
            </div>
            <button
                on:click={unlockVault}
                class="w-full mt-4 py-3 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
            >
                {$_('passwords.unlock')}
            </button>
            <button
                on:click={handleForgotPassword}
                class="w-full mt-3 py-2 text-slate-500 hover:text-red-600 text-sm font-bold"
            >
                {$_('passwords.forgot_password')}
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
            <h3 class="text-xl font-bold text-slate-800 mb-4">{$_('passwords.new_title')}</h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.label_title')} {$_('passwords.required_mark')}</label
                    >
                    <input
                        type="text"
                        bind:value={newPassword.title}
                        placeholder={$_('passwords.title_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.label_username')}</label
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
                        <span>{$_('passwords.label_password')} {$_('passwords.required_mark')}</span>
                        <button
                            on:click={() => generateNewPassword("new")}
                            class="text-blue-600 text-xs font-bold"
                        >
                            <i class="ph ph-magic-wand"></i> {$_('common.generate')}
                        </button>
                    </label>
                    <input
                        type="text"
                        bind:value={newPassword.password}
                        placeholder={$_('passwords.password_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 font-mono"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.label_url')}</label
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
                        >{$_('passwords.label_category')}</label
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
                        >{$_('passwords.label_notes')}</label
                    >
                    <textarea
                        bind:value={newPassword.notes}
                        rows="3"
                        placeholder={$_('passwords.notes_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                    ></textarea>
                </div>
            </div>
            <div class="flex gap-3 mt-4">
                <button
                    on:click={() => (showAddModal = false)}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    {$_('common.cancel')}
                </button>
                <button
                    on:click={addPassword}
                    class="flex-1 py-2.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
                >
                    {$_('common.save')}
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
            <h3 class="text-xl font-bold text-slate-800 mb-4">{$_('passwords.edit_title')}</h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.label_title')} {$_('passwords.required_mark')}</label
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
                        >{$_('passwords.label_username')}</label
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
                        <span>{$_('passwords.label_password')} {$_('passwords.required_mark')}</span>
                        <button
                            on:click={() => generateNewPassword("edit")}
                            class="text-blue-600 text-xs font-bold"
                        >
                            <i class="ph ph-magic-wand"></i> {$_('common.generate')}
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
                        >{$_('passwords.label_url')}</label
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
                        >{$_('passwords.label_category')}</label
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
                        >{$_('passwords.label_notes')}</label
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
                    {$_('common.cancel')}
                </button>
                <button
                    on:click={updatePassword}
                    class="flex-1 py-2.5 bg-amber-600 text-white rounded-lg font-bold hover:bg-amber-700"
                >
                    {$_('common.save')}
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
                <i class="ph-fill ph-password text-blue-600"></i> {$_('passwords.change_master_title')}
            </h3>
            <div class="space-y-3">
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.old_password_label')}</label
                    >
                    <input
                        type="password"
                        bind:value={oldMasterPassword}
                        placeholder={$_('passwords.old_password_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.new_password_label')}</label
                    >
                    <input
                        type="password"
                        bind:value={newMasterPassword}
                        placeholder={$_('passwords.new_password_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <div>
                    <label
                        class="text-xs font-bold text-slate-500 uppercase mb-1 block"
                        >{$_('passwords.confirm_new_label')}</label
                    >
                    <input
                        type="password"
                        bind:value={confirmNewMasterPassword}
                        on:keydown={(e) =>
                            e.key === "Enter" && handleChangeMasterPassword()}
                        placeholder={$_('passwords.confirm_new_placeholder')}
                        class="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400"
                    />
                </div>
            </div>
            <div class="flex gap-3 mt-4">
                <button
                    on:click={() => (showChangeMasterPasswordModal = false)}
                    class="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200"
                >
                    {$_('common.cancel')}
                </button>
                <button
                    on:click={handleChangeMasterPassword}
                    class="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                >
                    {$_('passwords.confirm_change')}
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
