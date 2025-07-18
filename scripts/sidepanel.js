// sidepanel.js

// Moved to the top for proper initialization
function updateSyncStatusUI(lastSyncTimestamp, nextSyncInSeconds) {
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateSyncStatusUI called. Last Sync: ${lastSyncTimestamp}, Next Sync In: ${nextSyncInSeconds}`);
    if (lastSyncTimestamp) {
        const lastSyncDate = new Date(lastSyncTimestamp);
        lastSyncTimeDiv.textContent = `Last Synced: ${lastSyncDate.toLocaleString()}`;
    } else {
        lastSyncTimeDiv.textContent = 'Last Synced: Never / In Progress';
    }

    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
    }

    // Only start countdown if a valid next sync time is provided
    if (nextSyncInSeconds !== undefined) {
        let remainingSeconds = nextSyncInSeconds;

        const updateCountdownText = () => {
            if (remainingSeconds <= 0) {
                // If countdown reaches 0 or starts at 0, display "Soon"
                // and stop the interval. A new sync will trigger a fresh update.
                nextSyncCountdownDiv.textContent = 'Next Sync: Soon';
                clearInterval(countdownIntervalId);
                // IMPORTANT: Do NOT re-request next sync time here.
                // The background script will inform the sidepanel when a sync
                // completes, providing the updated schedule then.
            } else {
                const minutes = Math.floor(remainingSeconds / 60);
                const seconds = remainingSeconds % 60;
                nextSyncCountdownDiv.textContent = `Next Sync: ${minutes}m ${seconds}s`;
                remainingSeconds--;
            }
        };

        // Call immediately to avoid initial delay
        updateCountdownText();
        countdownIntervalId = setInterval(updateCountdownText, 1000);
    } else {
        // If nextSyncInSeconds is undefined, show 'Calculating'
        nextSyncCountdownDiv.textContent = 'Next Sync: Calculating';
    }
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateSyncStatusUI finished.`);
}

// Global variables and constants
const activityCounts = {}; // This now represents the current session's input values
const runningTotals = {}; // Object for cumulative running totals
let currentTeam = null;
let loggedInUserEmail = null;
let activities = [];

// UI elements
const activityListDiv = document.getElementById('activity-list');
const authSection = document.getElementById('auth-section');
const authButton = document.getElementById('auth-button');
const statusMessageDiv = document.getElementById('status-message');
const teamSelectionDiv = document.getElementById('team-selection');
const refreshDataButton = document.getElementById('refresh-data-button');
const recalculateTotalsButton = document.getElementById('recalculate-totals-button');
const selectedTeamRow = document.getElementById('selected-team-row');
const selectedTeamLabel = document.getElementById('selected-team-label');
const teamSelect = document.getElementById('team-select');
const selectTeamButton = document.getElementById('select-team-button');
const logoutButton = document.getElementById('logout-button');
const lastSyncTimeDiv = document.getElementById('last-sync-time');
const nextSyncCountdownDiv = document.getElementById('next-sync-countdown');
const loadingIndicator = document.getElementById('loading-indicator');
let countdownIntervalId;
let statusMessageTimeoutId;
let statusMessageAlternateIntervalId = null;
let showWaiting = true;

// Cache configuration
const CACHE_DURATION_DAYS = 30;
const CACHE_DURATION_MS = CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000;

// Local sync history configuration
const SYNC_HISTORY_RETENTION_DAYS = 7; // Keep sync history for 7 days
const SYNC_HISTORY_RETENTION_MS = SYNC_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Helper functions for loading indicator
function showLoadingIndicator(message = 'Loading') {
    loadingIndicator.style.display = 'block';
    const loadingText = loadingIndicator.querySelector('p');
    if (loadingText) {
        loadingText.textContent = message;
    }
}

function hideLoadingIndicator() {
    loadingIndicator.style.display = 'none';
}

function showSuccessMessage(message) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.style.color = '';
}

// Helper functions for error handling
function showErrorMessage(message) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.style.color = '#CC3262';
}

// Cache helper functions
function getCacheKey(type, identifier = '') {
    return `cache_${type}_${identifier}_${loggedInUserEmail || 'anonymous'}`;
}

function getCacheTimestampKey(type, identifier = '') {
    return `cache_timestamp_${type}_${identifier}_${loggedInUserEmail || 'anonymous'}`;
}

async function isCacheValid(type, identifier = '') {
    const timestampKey = getCacheTimestampKey(type, identifier);
    const result = await chrome.storage.local.get(timestampKey);
    const timestamp = result[timestampKey];
    
    if (!timestamp) return false;
    
    const now = Date.now();
    return (now - timestamp) < CACHE_DURATION_MS;
}

async function setCacheData(type, data, identifier = '') {
    const cacheKey = getCacheKey(type, identifier);
    const timestampKey = getCacheTimestampKey(type, identifier);
    const timestamp = Date.now();
    
    await chrome.storage.local.set({
        [cacheKey]: data,
        [timestampKey]: timestamp
    });
}

async function getCacheData(type, identifier = '') {
    const cacheKey = getCacheKey(type, identifier);
    const result = await chrome.storage.local.get(cacheKey);
    return result[cacheKey];
}

async function clearCacheData(type, identifier = '') {
    const cacheKey = getCacheKey(type, identifier);
    const timestampKey = getCacheTimestampKey(type, identifier);
    await chrome.storage.local.remove([cacheKey, timestampKey]);
}

// Clear all cache data for the current user
async function clearAllUserCache() {
    if (!loggedInUserEmail) return;
    
    const storage = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(storage).filter(key => 
        key.includes(`_${loggedInUserEmail}`) && key.startsWith('cache_')
    );
    
    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log('Cleared user cache:', keysToRemove);
    }
}

const SPREADSHEET_ID = '1SdRqelVjMs8rpb48Tdn9ZK4Xc05u98D1_lSLdEmfgnA';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email';

// THEME TOGGLE
const changeThemeButton = document.getElementById('change-theme-button');

// Helper to set theme and button text
function setTheme(isLight) {
    if (isLight) {
        document.body.classList.add('light-theme');
        changeThemeButton.textContent = '⁂ Light Mode';
    } else {
        document.body.classList.remove('light-theme');
        changeThemeButton.textContent = '∯ Dark Mode';
    }
}

// Load theme preference on startup
chrome.storage.local.get('theme', (result) => {
    setTheme(result.theme === 'light');
});

// Toggle and persist theme on button click
changeThemeButton.addEventListener('click', () => {
    const isLight = !document.body.classList.contains('light-theme');
    setTheme(isLight);
    chrome.storage.local.set({ theme: isLight ? 'light' : 'dark' });
});

async function sendMessageToBackground(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, response => resolve(response));
    });
}

async function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, token => {
            if (chrome.runtime.lastError || !token) {
                reject(new Error(chrome.runtime.lastError?.message || "Failed to get auth token"));
            } else {
                resolve(token);
            }
        });
    });
}

async function sheetsApiGet(range) {
    const token = await getAuthToken(false);
    if (!token) throw new Error('No auth token for Sheets API');

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;

    const resp = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        },
    });
    if (!resp.ok) {
        throw new Error(`Sheets API error: ${resp.status} ${resp.statusText}`);
    }
    const data = await resp.json();
    return data;
}

function getTodayDateKey() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- Running Totals Management ---

// Get storage key for sync history
function getSyncHistoryStorageKey(dateKey) {
    return `syncHistory_${loggedInUserEmail}_${dateKey}`;
}

// Save sync data to local history
async function saveSyncToHistory(activitiesSynced, dateKey = null) {
    if (!dateKey) dateKey = getTodayDateKey();
    if (!activitiesSynced || activitiesSynced.length === 0) return;
    
    const historyKey = getSyncHistoryStorageKey(dateKey);
    const timestamp = Date.now();
    
    try {
        // Get existing history for the day
        const result = await chrome.storage.local.get(historyKey);
        const existingHistory = result[historyKey] || [];
        
        // Add new sync entry
        existingHistory.push({
            timestamp,
            activities: activitiesSynced,
            dateKey
        });
        
        // Save updated history
        await chrome.storage.local.set({ [historyKey]: existingHistory });
        console.log(`Saved sync history for ${dateKey}:`, activitiesSynced);
    } catch (error) {
        console.error('Error saving sync history:', error);
    }
}

// Get sync history for a specific date
async function getSyncHistory(dateKey = null) {
    if (!dateKey) dateKey = getTodayDateKey();
    
    const historyKey = getSyncHistoryStorageKey(dateKey);
    const result = await chrome.storage.local.get(historyKey);
    return result[historyKey] || [];
}

// Calculate running totals from local sync history
async function calculateRunningTotalsFromHistory(dateKey = null) {
    if (!dateKey) dateKey = getTodayDateKey();
    
    const history = await getSyncHistory(dateKey);
    const totals = {};
    
    // Sum up all synced activities for the day
    history.forEach(syncEntry => {
        syncEntry.activities.forEach(activity => {
            if (!totals[activity.id]) {
                totals[activity.id] = 0;
            }
            totals[activity.id] += activity.count;
        });
    });
    
    return totals;
}

// Fetch running totals from Google Sheets for a specific date
async function fetchRunningTotalsFromSheets(dateKey = null) {
    if (!dateKey) dateKey = getTodayDateKey();
    if (!loggedInUserEmail) throw new Error('No user logged in');
    
    try {
        console.log(`Fetching running totals from Google Sheets for ${dateKey}...`);
        
        // Get all data from the Logs sheet
        const data = await sheetsApiGet('Logs!A:D');
        if (!data.values || data.values.length === 0) {
            console.log('No data found in Logs sheet');
            return {};
        }
        
        const totals = {};
        
        // Process each row (skip header if present)
        data.values.forEach((row, index) => {
            if (index === 0 && row[0] === 'Timestamp') return; // Skip header
            
            const [timestamp, userEmail, activityName, count] = row;
            
            // Check if this entry is for the current user and date
            if (userEmail === loggedInUserEmail && timestamp) {
                const entryDate = new Date(timestamp);
                const entryDateKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;
                
                if (entryDateKey === dateKey) {
                    // Find the activity ID for this activity name
                    const activity = activities.find(act => act.name === activityName);
                    if (activity) {
                        const activityId = activity.id;
                        if (!totals[activityId]) {
                            totals[activityId] = 0;
                        }
                        totals[activityId] += parseInt(count) || 0;
                    }
                }
            }
        });
        
        console.log(`Running totals from sheets for ${dateKey}:`, totals);
        return totals;
        
    } catch (error) {
        console.error('Error fetching running totals from sheets:', error);
        throw error;
    }
}

// Clean up old sync history (keep only last 7 days)
async function cleanupOldSyncHistory() {
    if (!loggedInUserEmail) return;
    
    const storage = await chrome.storage.local.get(null);
    const now = Date.now();
    const keysToRemove = [];
    
    Object.keys(storage).forEach(key => {
        if (key.startsWith(`syncHistory_${loggedInUserEmail}_`)) {
            const dateKey = key.split('_')[2];
            if (dateKey) {
                const [year, month, day] = dateKey.split('-');
                const historyDate = new Date(year, month - 1, day);
                const daysDiff = (now - historyDate.getTime()) / (1000 * 60 * 60 * 24);
                
                if (daysDiff > SYNC_HISTORY_RETENTION_DAYS) {
                    keysToRemove.push(key);
                }
            }
        }
    });
    
    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`Cleaned up ${keysToRemove.length} old sync history entries`);
    }
}

// Recalculate running totals using multiple sources
async function recalculateRunningTotals() {
    showLoadingIndicator('Recalculating totals...');
    
    try {
        const dateKey = getTodayDateKey();
        let totals = {};
        
        // Method 1: Try to get from Google Sheets first (authoritative source)
        try {
            const sheetTotals = await fetchRunningTotalsFromSheets(dateKey);
            if (Object.keys(sheetTotals).length > 0) {
                totals = sheetTotals;
                console.log('Using running totals from Google Sheets (authoritative):', totals);
            } else {
                console.log('No running totals found in sheets for today');
            }
        } catch (error) {
            console.error('Error fetching from sheets, trying local history:', error);
            // Method 2: Fallback to local sync history
            const historyTotals = await calculateRunningTotalsFromHistory(dateKey);
            if (Object.keys(historyTotals).length > 0) {
                totals = historyTotals;
                console.log('Using running totals from local sync history:', totals);
            }
        }
        
        // Update running totals in memory and storage
        // Important: Replace with authoritative totals from sheets/history
        // This is the source of truth for what has been synced
        activities.forEach(activity => {
            const authoritativeTotal = totals[activity.id] || 0;
            
            // Replace local running total with authoritative total
            // This ensures we show what's actually been synced to sheets
            runningTotals[activity.id] = authoritativeTotal;
        });
        
        // Save updated running totals to storage
        const runningTotalStorageKey = `runningTotals_${loggedInUserEmail}_${dateKey}`;
        await chrome.storage.local.set({ [runningTotalStorageKey]: runningTotals });
        
        // Update UI
        updateActivityCountsUI();
        
        hideLoadingIndicator();
        
        const totalFromSheets = Object.values(totals).reduce((sum, count) => sum + count, 0);
        
        if (totalFromSheets > 0) {
            showSuccessMessage(`Running totals recalculated from sheets! Total synced activities: ${totalFromSheets}`);
        } else {
            showSuccessMessage('Running totals recalculated. No synced activities found for today.');
        }
        
    } catch (error) {
        console.error('Error recalculating running totals:', error);
        hideLoadingIndicator();
        showErrorMessage(`Error recalculating totals: ${error.message}. Please try again.`);
    }
}

// Validate and correct running totals at startup
async function validateAndCorrectRunningTotals() {
    if (!loggedInUserEmail || !activities || activities.length === 0) return;
    
    const dateKey = getTodayDateKey();
    const runningTotalStorageKey = `runningTotals_${loggedInUserEmail}_${dateKey}`;
    
    try {
        // Check if we have any running totals stored
        const result = await chrome.storage.local.get(runningTotalStorageKey);
        const storedTotals = result[runningTotalStorageKey] || {};
        
        // Check if totals are all zero but we have sync history
        const allZero = Object.values(storedTotals).every(total => total === 0);
        const hasHistory = (await getSyncHistory(dateKey)).length > 0;
        
        if (allZero && hasHistory) {
            console.log('Detected zero running totals but sync history exists. Auto-correcting...');
            await recalculateRunningTotals();
        } else if (Object.keys(storedTotals).length === 0) {
            // No stored totals, check if we have data in sheets
            try {
                const sheetTotals = await fetchRunningTotalsFromSheets(dateKey);
                if (Object.keys(sheetTotals).length > 0) {
                    console.log('Found running totals in sheets, loading them...');
                    
                    // Update running totals in memory
                    activities.forEach(activity => {
                        runningTotals[activity.id] = sheetTotals[activity.id] || 0;
                    });
                    
                    // Save to storage
                    await chrome.storage.local.set({ [runningTotalStorageKey]: runningTotals });
                    
                    // Update UI
                    updateActivityCountsUI();
                    
                    const totalCount = Object.values(sheetTotals).reduce((sum, count) => sum + count, 0);
                    console.log(`Auto-loaded ${totalCount} running totals from sheets`);
                }
            } catch (error) {
                console.log('No running totals found in sheets or error fetching:', error.message);
            }
        }
        
    } catch (error) {
        console.error('Error validating running totals:', error);
    }
}

refreshDataButton.addEventListener('click', async () => {
    if (!currentTeam) {
        showErrorMessage('No team selected. Please select a team first.');
        return;
    }

    showLoadingIndicator('Refreshing data');
    try {
        // Clear cache for teams and current team's activities
        await clearCacheData('teams');
        await clearCacheData('activities', currentTeam);
        
        // Refresh activities for current team
        await loadInitialCountsAndActivities(currentTeam);
        
        hideLoadingIndicator();
        showSuccessMessage('Data refreshed successfully');
    } catch (err) {
        console.error('Error refreshing data:', err);
        hideLoadingIndicator();
        showErrorMessage(`Error refreshing data: ${err.message}. Please try again.`);
    }
});

recalculateTotalsButton.addEventListener('click', async () => {
    if (!currentTeam) {
        showErrorMessage('No team selected. Please select a team first.');
        return;
    }

    if (!loggedInUserEmail) {
        showErrorMessage('No user logged in. Please log in first.');
        return;
    }

    await recalculateRunningTotals();
});

// --- Authentication & Initialization ---

async function login() {
    const response = await sendMessageToBackground({ action: 'login' });
    if (response.success) {
        loggedInUserEmail = response.email;
        statusMessageDiv.textContent = `Logged in as: ${loggedInUserEmail}`;
        authSection.style.display = 'none';
        logoutButton.style.display = 'block';
        await showTeamSelection();
    } else {
        const errorMessage = response.error || 'Login failed';
        if (errorMessage.includes('User denied')) {
            throw new Error('Login was cancelled by user');
        } else if (errorMessage.includes('network')) {
            throw new Error('Network error. Please check your internet connection');
        } else if (errorMessage.includes('token')) {
            throw new Error('Authentication token error. Please try again');
        } else {
            throw new Error(errorMessage);
        }
    }
}

async function logout() {
    const response = await sendMessageToBackground({ action: 'logout' });
    if (response.success) {
        // Clear all cache data for the current user
        await clearAllUserCache();
        
        statusMessageDiv.textContent = 'Logged out.';
        authButton.style.display = 'block';
        authSection.style.display = '';
        logoutButton.style.display = 'none';
        activityListDiv.style.display = 'none';
        teamSelectionDiv.style.display = 'none';
        selectedTeamRow.style.display = 'none'; // <-- Hide selected team row
        refreshDataButton.style.display = 'none'; // Hide refresh button
        recalculateTotalsButton.style.display = 'none'; // Hide recalculate button
        teamSelect.innerHTML = ''; // <-- Clear team dropdown
        // Clear all activity and running total counts locally
        for (const key in activityCounts) delete activityCounts[key];
        for (const key in runningTotals) delete runningTotals[key];
        activities = [];
        currentTeam = null;
        loggedInUserEmail = null;
        if (statusMessageAlternateIntervalId) {
            clearInterval(statusMessageAlternateIntervalId);
            statusMessageAlternateIntervalId = null;
        }
        // Remove userTeam from storage
        await chrome.storage.sync.remove('userTeam');
        updateActivityCountsUI(); // Clear UI
        updateSyncStatusUI(null, undefined); // Clear sync status UI on logout
    } else {
        throw new Error(response.error || 'Logout failed');
    }
}

// --- Fetch Teams from Sheets with Caching ---

async function fetchTeamsFromSheets(useCache = true) {
    const cacheType = 'teams';
    
    // Try to get from cache first
    if (useCache && await isCacheValid(cacheType)) {
        const cachedTeams = await getCacheData(cacheType);
        if (cachedTeams && cachedTeams.length > 0) {
            console.log('Using cached teams data');
            return cachedTeams;
        }
    }
    
    try {
        console.log('Fetching teams from Google Sheets');
        const data = await sheetsApiGet('CONFIG!A:A');
        if (!data.values || data.values.length === 0) {
            throw new Error('No team data found in spreadsheet');
        }
        
        const rawTeams = data.values.slice(1).flat().filter(t => t && t.trim() !== '');
        const uniqueTeams = [...new Set(rawTeams)];
        
        if (uniqueTeams.length === 0) {
            throw new Error('No valid teams found');
        }
        
        // Cache the results
        await setCacheData(cacheType, uniqueTeams);
        console.log('Teams cached successfully');
        
        return uniqueTeams;
    } catch (err) {
        console.error('Error fetching teams:', err);
        
        // If fetch fails, try to return cached data even if expired
        const cachedTeams = await getCacheData(cacheType);
        if (cachedTeams && cachedTeams.length > 0) {
            console.log('Using expired cached teams data due to fetch error');
            return cachedTeams;
        }
        
        throw err;
    }
}

// --- Fetch Activities for Selected Team from Sheets with Caching ---

async function fetchActivitiesForTeam(teamName, useCache = true) {
    const cacheType = 'activities';
    
    // Try to get from cache first
    if (useCache && await isCacheValid(cacheType, teamName)) {
        const cachedActivities = await getCacheData(cacheType, teamName);
        if (cachedActivities && cachedActivities.length > 0) {
            console.log(`Using cached activities data for team: ${teamName}`);
            return cachedActivities;
        }
    }
    
    try {
        console.log(`Fetching activities for team ${teamName} from Google Sheets`);
        const data = await sheetsApiGet('CONFIG!A:C');
        if (!data.values) {
            throw new Error('No activity data found in spreadsheet');
        }
        
        const teamActivities = data.values.filter(row => row[0] === teamName);
        const activities = teamActivities.map(row => ({
            id: row[1],
            name: row[2] || row[1]
        }));
        
        if (activities.length === 0) {
            throw new Error(`No activities found for team: ${teamName}`);
        }
        
        // Cache the results
        await setCacheData(cacheType, activities, teamName);
        console.log(`Activities cached successfully for team: ${teamName}`);
        
        return activities;
    } catch (err) {
        console.error('Error fetching activities:', err);
        
        // If fetch fails, try to return cached data even if expired
        const cachedActivities = await getCacheData(cacheType, teamName);
        if (cachedActivities && cachedActivities.length > 0) {
            console.log(`Using expired cached activities data for team: ${teamName}`);
            return cachedActivities;
        }
        
        throw err;
    }
}

// Helper to get the storage key for activity order
function getActivityOrderStorageKey() {
    return `activityOrder_${loggedInUserEmail}_${currentTeam}`;
}

// Save the current order to chrome.storage.sync
async function saveActivityOrder() {
    const key = getActivityOrderStorageKey();
    const order = activities.map(a => a.id);
    await chrome.storage.sync.set({ [key]: order });
}

// Load the order from chrome.storage.sync and reorder activities array
async function loadActivityOrder() {
    const key = getActivityOrderStorageKey();
    const obj = await chrome.storage.sync.get(key);
    const order = obj[key];
    if (order && Array.isArray(order)) {
        // Reorder activities array in-place
        activities.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
}

// --- UI Handlers ---

authButton.addEventListener('click', async () => {
    showLoadingIndicator('Logging in');
    try {
        await login();
        hideLoadingIndicator();
        showSuccessMessage('Login successful!');
    } catch (err) {
        console.error('Auth error:', err);
        hideLoadingIndicator();
        showErrorMessage(`Login failed: ${err.message}. Please try again.`);
    }
});

logoutButton.addEventListener('click', async () => {
    showLoadingIndicator('Logging out');
    try {
        await logout();
        hideLoadingIndicator();
        showSuccessMessage('Logged out successfully');
    } catch (err) {
        console.error('Logout error:', err);
        hideLoadingIndicator();
        showErrorMessage(`Logout failed: ${err.message}. Please try again.`);
    }
});

// Call this after selecting a team:
function showSelectedTeam(teamName) {
    selectedTeamLabel.textContent = `Selected Team: ${teamName}`;
    selectedTeamRow.style.display = 'flex';
    teamSelectionDiv.style.display = 'none';
    refreshDataButton.style.display = ''; // Show the refresh button
    recalculateTotalsButton.style.display = ''; // Show the recalculate button
}

async function showTeamSelection() {
    teamSelectionDiv.style.display = 'block';
    activityListDiv.style.display = 'none';

    // Show loading indicator
    showLoadingIndicator('Loading teams');

    try {
        // First, try to load from cache immediately for fast UI rendering
        const cachedTeams = await getCacheData('teams');
        if (cachedTeams && cachedTeams.length > 0) {
            console.log('Rendering teams from cache');
            renderTeamOptions(cachedTeams);
            hideLoadingIndicator();
        }

        // Then fetch fresh data in the background
        const teams = await fetchTeamsFromSheets(true);
        
        // Update UI with fresh data if it's different from cached data
        if (!cachedTeams || JSON.stringify(cachedTeams) !== JSON.stringify(teams)) {
            console.log('Updating teams with fresh data');
            renderTeamOptions(teams);
        }
        
        hideLoadingIndicator();
        showSuccessMessage('Teams loaded successfully');
        
    } catch (error) {
        console.error('Error in showTeamSelection:', error);
        hideLoadingIndicator();
        showErrorMessage(`Error loading teams: ${error.message}. Please check your internet connection.`);
    }
}

function renderTeamOptions(teams) {
    teamSelect.innerHTML = '<option value="">--Select a Team--</option>';
    teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team;
        option.textContent = team;
        teamSelect.appendChild(option);
    });

    // Restore previously selected team if available
    chrome.storage.sync.get('userTeam').then(obj => {
        const userTeam = obj.userTeam;
        if (userTeam && teams.includes(userTeam)) {
            teamSelect.value = userTeam;
        }
    });
}

selectTeamButton.addEventListener('click', async () => {
    const selectedTeam = teamSelect.value;
    if (!selectedTeam) {
        showErrorMessage('Please select a team first.');
        return;
    }

    showLoadingIndicator('Setting up team');
    try {
        // Clear cache for the previous team's activities if switching teams
        if (currentTeam && currentTeam !== selectedTeam) {
            await clearCacheData('activities', currentTeam);
        }
        
        const response = await sendMessageToBackground({ action: 'teamSelected', team: selectedTeam });
        if (response.success) {
            currentTeam = selectedTeam;
            showSelectedTeam(selectedTeam); // <-- This handles showing the selected team row and hiding the selection
            activityListDiv.style.display = 'block';
            await loadInitialCountsAndActivities(selectedTeam);

            // NEW: Start the sync alarm/countdown after activities are loaded
            await sendMessageToBackground({ action: 'startSyncAlarm' });
            // Immediately request the next sync time to update the countdown
            chrome.runtime.sendMessage({ action: 'requestNextSyncTime' }, (response) => {
                if (response && response.success) {
                    updateSyncStatusUI(response.lastSyncTimestamp, response.nextSyncInSeconds);
                } else {
                    console.error("Failed to get next sync time after alarm start:", response?.error);
                    updateSyncStatusUI(null, undefined);
                }
            });
            
            hideLoadingIndicator();
            showSuccessMessage(`Team ${selectedTeam} selected successfully`);
        } else {
            throw new Error(response.error || 'Failed to select team.');
        }
    } catch (err) {
        console.error('Error selecting team:', err);
        hideLoadingIndicator();
        showErrorMessage(`Error selecting team: ${err.message}. Please try again.`);
    }
});

// Load activities and counts for the selected team
async function loadInitialCountsAndActivities(team) {
    if (!team) return;

    // Show loading indicator
    showLoadingIndicator('Loading activities');

    // Clear activity list immediately to prevent flicker/stale data
    activityListDiv.innerHTML = '';
    activityListDiv.style.display = 'none';

    try {
        // First, try to load from cache immediately for fast UI rendering
        const cachedActivities = await getCacheData('activities', team);
        if (cachedActivities && cachedActivities.length > 0) {
            console.log(`Rendering activities from cache for team: ${team}`);
            activities = cachedActivities;
            await loadAndRenderActivities();
            hideLoadingIndicator();
        }

        // Then fetch fresh data in the background
        const freshActivities = await fetchActivitiesForTeam(team, true);
        
        // Update UI with fresh data if it's different from cached data
        if (!cachedActivities || JSON.stringify(cachedActivities) !== JSON.stringify(freshActivities)) {
            console.log(`Updating activities with fresh data for team: ${team}`);
            activities = freshActivities;
            await loadAndRenderActivities();
        }
        
        hideLoadingIndicator();
        showSuccessMessage(`Activities loaded for ${team}`);
        
    } catch (error) {
        console.error('Error loading activities/counts:', error);
        hideLoadingIndicator();
        showErrorMessage(`Error loading activities: ${error.message}. Please check your internet connection.`);
        activityListDiv.innerHTML = '';
        activityListDiv.style.display = 'none';
    }
}

async function loadAndRenderActivities() {
    // Load persisted order and apply it
    await loadActivityOrder();

    const todayDateKey = getTodayDateKey();
    if (!loggedInUserEmail) {
        const obj = await chrome.storage.sync.get('loggedInUserEmail');
        loggedInUserEmail = obj.loggedInUserEmail || null;
        if (!loggedInUserEmail) {
            throw new Error('User email not found. Please log in again.');
        }
    }
    
    const activityStorageKey = `activityData_${loggedInUserEmail}_${todayDateKey}`;
    const runningTotalStorageKey = `runningTotals_${loggedInUserEmail}_${todayDateKey}`;

    const result = await chrome.storage.local.get([activityStorageKey, runningTotalStorageKey]);
    const storedActivityData = result[activityStorageKey];
    const storedRunningTotalData = result[runningTotalStorageKey];

    // Initialize activityCounts from local storage (these are the current session's inputs)
    activities.forEach(act => activityCounts[act.id] = 0);
    if (storedActivityData && storedActivityData.activities) {
        for (const [activityId, data] of Object.entries(storedActivityData.activities)) {
            if (activities.some(act => act.id === activityId)) {
                activityCounts[activityId] = data.count;
            }
        }
    }

    // Initialize runningTotals from local storage
    activities.forEach(act => runningTotals[act.id] = 0);
    if (storedRunningTotalData) {
        for (const [activityId, total] of Object.entries(storedRunningTotalData)) {
            if (activities.some(act => act.id === activityId)) {
                runningTotals[activityId] = total;
            }
        }
    }

    renderActivitiesUI();
    updateActivityCountsUI();
    activityListDiv.style.display = 'block'; // Show after successful load
    
    // Validate and correct running totals if needed
    await validateAndCorrectRunningTotals();
}

function renderActivitiesUI() {
    activityListDiv.innerHTML = '';
    // Add the grid-header back when rendering activities
    const headerDiv = document.createElement('div');
    headerDiv.className = 'grid-header';
    headerDiv.innerHTML = '<p>Task Name</p><p>Count</p><p>Today Total</p>';
    activityListDiv.appendChild(headerDiv);

    if (!activities || activities.length === 0) {
        const noActivitiesMessage = document.createElement('p');
        noActivitiesMessage.textContent = 'No activities found for this team.';
        activityListDiv.appendChild(noActivitiesMessage);
        return;
    }

    activities.forEach(activity => {
        const activityDiv = document.createElement('div');
        activityDiv.className = 'activity-item';
        activityDiv.dataset.activityId = activity.id; // Needed for Sortable

        const label = document.createElement('span');
        label.className = 'activity-name';
        label.textContent = activity.name;

        // Create the new activity-controls div
        const activityControlsDiv = document.createElement('div');
        activityControlsDiv.className = 'activity-controls';

        const btnMinus = document.createElement('button');
        btnMinus.textContent = `-`;
        btnMinus.title = 'Decrease count';
        btnMinus.className = 'btn btn-minus';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = 0;
        input.value = activityCounts[activity.id] || 0; // Current count (local input)
        input.className = 'activity-count';
        input.dataset.activityId = activity.id;

        const btnPlus = document.createElement('button');
        btnPlus.textContent = '+';
        btnPlus.title = 'Increase count';
        btnPlus.className = 'btn';

        const runningTotalSpan = document.createElement('span'); // New element for running total
        runningTotalSpan.className = 'running-total';
        runningTotalSpan.dataset.activityId = activity.id; // Store activityId for easy update
        runningTotalSpan.textContent = `Total: ${runningTotals[activity.id] || 0}`; // Display running total

        // Append buttons and input to the new activityControlsDiv
        activityControlsDiv.appendChild(btnMinus);
        activityControlsDiv.appendChild(input);
        activityControlsDiv.appendChild(btnPlus);

        // Append all parts to the activityDiv
        activityDiv.appendChild(label);
        activityDiv.appendChild(activityControlsDiv); // Append the controls wrapper
        activityDiv.appendChild(runningTotalSpan); // Add the running total span

        // Add event listeners (these remain the same)
        btnMinus.addEventListener('click', async () => {
            let val = parseInt(input.value) || 0;
            if (val > 0) val--;
            input.value = val;
            activityCounts[activity.id] = val; // Update local activityCounts
            await updateLocalActivityData(activity.id, val, activity.name);
            // No need to call updateActivityCountsUI here unless runningTotals change
        });

        btnPlus.addEventListener('click', async () => {
            let val = parseInt(input.value) || 0;
            val++;
            input.value = val;
            activityCounts[activity.id] = val; // Update local activityCounts
            await updateLocalActivityData(activity.id, val, activity.name);
            // No need to call updateActivityCountsUI here unless runningTotals change
        });

        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            e.target.value = val;
            activityCounts[activity.id] = val; // Update local activityCounts
            await updateLocalActivityData(activity.id, val, activity.name);
            // No need to call updateActivityCountsUI here unless runningTotals change
        });

        activityListDiv.appendChild(activityDiv);
    });

    // Enable drag-and-drop reordering (skip header)
    if (window.Sortable) {
        Sortable.create(activityListDiv, {
            animation: 150,
            handle: '.activity-name, .running-total', // Only drag by name or total
            filter: '.grid-header',
            draggable: '.activity-item',
            onEnd: async function () {
                // Update activities array to match new order
                const newOrder = [];
                activityListDiv.querySelectorAll('.activity-item').forEach(div => {
                    const id = div.dataset.activityId;
                    const act = activities.find(a => a.id === id);
                    if (act) newOrder.push(act);
                });
                activities = newOrder;
                await saveActivityOrder(); // Persist new order
            }
        });
    }
}

function updateActivityCountsUI() {
    const inputs = activityListDiv.querySelectorAll('input.activity-count');
    inputs.forEach(input => {
        const id = input.dataset.activityId;
        input.value = activityCounts[id] || 0; // Display current session's count
    });

    const totalSpans = activityListDiv.querySelectorAll('span.running-total');
    totalSpans.forEach(span => {
        const id = span.dataset.activityId;
        const totalValue = runningTotals[id] || 0; // Retrieve value from in-memory runningTotals
        span.textContent = ` Total: ${totalValue}`; // Display cumulative running total
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Updating UI for ${id}. Running total: ${totalValue}`);
    });
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateActivityCountsUI finished.`);
}

async function updateLocalActivityData(activityId, count, activityName) {
    const todayDateKey = getTodayDateKey();
    const data = {
        team: currentTeam,
        activities: { // Ensure this is 'activities' to match background.js structure
            [activityId]: {
                count: count,
                name: activityName
            }
        }
    };
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Attempting to update local activity data for ${activityId} to ${count}`);
        await sendMessageToBackground({
            action: 'updateLocalActivityData',
            userEmail: loggedInUserEmail,
            todayDateKey,
            activityId,
            data
        });
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Successfully sent updateLocalActivityData message.`);
    } catch (error) {
        console.error('Failed to update local activity data:', error);
        statusMessageDiv.textContent = 'Failed to save activity data locally.';
    }
}


async function updateLocalRunningTotals(syncedActivities) {
    console.log('syncedActivities:', syncedActivities);
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Called updateLocalRunningTotals. LoggedInUserEmail: ${loggedInUserEmail}, CurrentTeam: ${currentTeam}`); // NEW LOG
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateLocalRunningTotals received syncedActivities:`, JSON.stringify(syncedActivities));
    const todayDateKey = getTodayDateKey();
    const runningTotalStorageKey = `runningTotals_${loggedInUserEmail}_${todayDateKey}`;
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Constructed runningTotalStorageKey: ${runningTotalStorageKey}`); // NEW LOG

    // Fetch current running totals from storage
    const result = await chrome.storage.local.get(runningTotalStorageKey);
    const currentRunningTotals = result[runningTotalStorageKey] || {};
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Current running totals from storage (before update):`, JSON.stringify(currentRunningTotals));

    // Update running totals based on synced activities
    syncedActivities.forEach(item => {
        const activityId = item.id;
        const count = item.count;

        if (activityId && typeof count === 'number') {
            currentRunningTotals[activityId] = (currentRunningTotals[activityId] || 0) + count;
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Updated currentRunningTotals for ${activityId} to ${currentRunningTotals[activityId]} (added ${count})`);
        }
    });

    // Save the updated running totals back to storage
    await chrome.storage.local.set({ [runningTotalStorageKey]: currentRunningTotals });
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Saved running totals to storage:`, JSON.stringify(currentRunningTotals));

    // Update the in-memory runningTotals object
    Object.assign(runningTotals, currentRunningTotals);
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: In-memory runningTotals after Object.assign:`, JSON.stringify(runningTotals));
}

// Listener for messages from background script about sync status and UI clear
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Received message:`, request);
    if (request.action === "updateSyncStatus") {
        updateSyncStatusUI(request.lastSyncTimestamp, request.nextSyncInSeconds);
        // Optionally update status message from background
        if (request.statusMessage) {
            statusMessageDiv.textContent = request.statusMessage;
        } else if (request.error) {
            statusMessageDiv.textContent = `Sync Error: ${request.error}`;
        } else {
            statusMessageDiv.textContent = 'Sync status updated.';
        }
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Handled updateSyncStatus.`);
        sendResponse({ success: true });
    } else if (request.action === "syncCompleteAndClearUI") {
        (async () => { // Make this section async to await storage retrieval
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Handling syncCompleteAndClearUI.`);
            const tempSyncedActivitiesKey = request.tempSyncedActivitiesKey; // NEW: Get the key

            let syncedActivities = [];
            if (tempSyncedActivitiesKey) {
                try {
                    const result = await chrome.storage.local.get(tempSyncedActivitiesKey);
                    syncedActivities = result[tempSyncedActivitiesKey] || [];
                    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Retrieved synced activities from storage:`, syncedActivities); // NEW LOG
                    // Inform background to clear the temporary storage
                    await sendMessageToBackground({ action: 'sidepanelReadyForSyncedActivitiesClear', keyToClear: tempSyncedActivitiesKey });
                } catch (error) {
                    console.error(`[${new Date().toLocaleTimeString()}] Sidepanel: Error retrieving synced activities from storage:`, error);
                }
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: No temporary storage key provided for synced activities.`);
            }

            // First, update running totals based on what was just synced
            if (syncedActivities.length > 0) {
                await updateLocalRunningTotals(syncedActivities); // Ensure this is awaited
                
                // Save sync history for future recalculation
                await saveSyncToHistory(syncedActivities);
                
                // Clean up old sync history to save space
                await cleanupOldSyncHistory();
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: No synced activities to process for running totals.`);
            }

            // Then, reset all current activity counts in the UI to 0
            activities.forEach(act => activityCounts[act.id] = 0);
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: activityCounts reset to 0:`, activityCounts);
            updateActivityCountsUI(); // Re-render the UI with reset current counts and updated running totals
            updateSyncStatusUI(request.lastSyncTimestamp, request.nextSyncInSeconds);
            statusMessageDiv.textContent = 'Data synced and counts reset!';
            // Clear any previous timeout to avoid overlaps
            if (statusMessageTimeoutId) {
                clearTimeout(statusMessageTimeoutId);
            }
            if (statusMessageAlternateIntervalId) {
                clearInterval(statusMessageAlternateIntervalId);
            }

            // Set a timeout to start alternating messages after 10 seconds
            statusMessageTimeoutId = setTimeout(() => {
                function alternateStatusMessage() {
                    if (showWaiting) {
                        statusMessageDiv.textContent = 'Waiting for the next sync';
                    } else if (loggedInUserEmail) {
                        statusMessageDiv.textContent = `Logged in as: ${loggedInUserEmail}`;
                    }
                    showWaiting = !showWaiting;
                }
                alternateStatusMessage(); // Show first message
                statusMessageAlternateIntervalId = setInterval(alternateStatusMessage, 40000);
                statusMessageTimeoutId = null;
            }, 25000);
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: syncCompleteAndClearUI complete.`);
            sendResponse({ success: true }); // Acknowledge receipt after all processing
        })(); // Self-executing async function
        return true; // Indicate that sendResponse will be called asynchronously
    }
    return false; // For other messages, if any, that don't return true for async sendResponse
});

// --- Initialization ---
(async () => {
    showLoadingIndicator('Initializing');
    
    try {
        const obj = await chrome.storage.sync.get('loggedInUserEmail');
        loggedInUserEmail = obj.loggedInUserEmail || null;

        if (loggedInUserEmail) {
            authSection.style.display = 'none';
            logoutButton.style.display = 'block';
            statusMessageDiv.textContent = `Logged in as: ${loggedInUserEmail}`;

            // Clean up old sync history on startup
            await cleanupOldSyncHistory();

            // Get team information
            const tObj = await chrome.storage.sync.get('userTeam');
            const team = tObj.userTeam;
            
            if (team) {
                currentTeam = team;
                showSelectedTeam(team); // <-- Show the selected team row
                activityListDiv.style.display = 'block';
                
                // Load team and activities optimistically
                await loadInitialCountsAndActivities(team);
                
                // Initialize sync status
                chrome.runtime.sendMessage({ action: 'requestNextSyncTime' }, (response) => {
                    if (response && response.success) {
                        updateSyncStatusUI(response.lastSyncTimestamp, response.nextSyncInSeconds);
                    } else {
                        console.error("Failed to get initial next sync time:", response?.error);
                        updateSyncStatusUI(null, undefined);
                    }
                });
            } else {
                await showTeamSelection(); // <-- Show the team selection UI
            }
            
            hideLoadingIndicator();
            showSuccessMessage('Extension initialized successfully');
        } else {
            hideLoadingIndicator();
            updateSyncStatusUI(null, undefined);
            authButton.style.display = 'block';
            authSection.style.display = '';
            logoutButton.style.display = 'none';
            teamSelectionDiv.style.display = 'none';
            activityListDiv.style.display = 'none';
            statusMessageDiv.textContent = 'Please log in to start tracking activities.';
        }
    } catch (error) {
        console.error('Initialization error:', error);
        hideLoadingIndicator();
        showErrorMessage(`Initialization failed: ${error.message}. Please try refreshing the page.`);
    }
})();